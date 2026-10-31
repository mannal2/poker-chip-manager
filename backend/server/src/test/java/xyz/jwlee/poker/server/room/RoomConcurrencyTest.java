package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.junit.jupiter.api.RepeatedTest;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.support.IdGenerator;

// 같은 상태 버전으로 동시에 들어온 명령 중 하나만 적용되는지 검사한다.
class RoomConcurrencyTest {

    private static final int PEOPLE = Room.MAX_PARTICIPANTS;
    private static final int THREADS = 20;

    private final RoomRegistry registry = new RoomRegistry(IdGenerator.random(), Clock.systemUTC());
    private final CommandPipeline pipeline = new CommandPipeline();
    private final Map<String, Long> sequences = new HashMap<>();

    // 요청 원장은 다음 순번만 허용하므로 참가자 10명의 첫 요청을 동시에 보내고, 각 참가자의 두 번째 요청은 첫 요청이 끝난 뒤 같은 상태 버전으로 보낸다.
    @RepeatedTest(10)
    void twentyThreadsAtOneVersionApplyOnceAndKeepTheChips() throws Exception {
        List<String> ids = new ArrayList<>();
        RoomRegistry.Entry host = registry.create("P0");
        ids.add(host.participantId());
        for (int i = 1; i < PEOPLE; i++) {
            ids.add(registry.join(host.code(), "P" + i).participantId());
        }
        String roomId = host.roomId();
        setUp(roomId, ids);

        GameState game = read(roomId, Room::game);
        long version = read(roomId, Room::version);
        String actor = actor(roomId);
        CyclicBarrier start = new CyclicBarrier(THREADS);
        List<CompletableFuture<RequestOutcome>> all = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(THREADS)) {
            for (String id : ids) {
                long first = nextSequence(id);
                long second = nextSequence(id);
                String type = type(id, ids, actor);
                String payload = payload(id, ids, actor);
                CompletableFuture<RequestOutcome> race = CompletableFuture.supplyAsync(() -> {
                    await(start);
                    return send(roomId, id, first, version, game, type, payload);
                }, pool);
                CompletableFuture<RequestOutcome> follow = CompletableFuture.supplyAsync(() -> {
                    await(start);
                    race.join();
                    return send(roomId, id, second, version, game, type, payload);
                }, pool);
                all.add(race);
                all.add(follow);
            }
            CompletableFuture.allOf(all.toArray(CompletableFuture[]::new)).get(30, TimeUnit.SECONDS);
        }

        List<String> codes = all.stream().map(f -> f.join().code()).toList();
        assertThat(codes).hasSize(THREADS);
        assertThat(codes.stream().filter("OK"::equals)).hasSize(1);
        assertThat(codes.stream().filter("STALE_STATE"::equals)).hasSize(THREADS - 1);
        assertThat(all.stream().filter(f -> f.join().outcome() == RequestOutcome.Outcome.APPLIED)).hasSize(1);
        assertThat((long) read(roomId, Room::version)).isEqualTo(version + 1);
        assertThat(chips(roomId)).isEqualTo(PEOPLE * 1000);
    }

    // 설정·딜러·시작까지 진행해 게임 중인 방을 만든다.
    private void setUp(String roomId, List<String> ids) {
        String hostId = ids.get(0);
        registry.withRoom(roomId, room -> {
            ids.forEach(id -> room.presence().attach(id, "conn-" + id, java.time.Instant.now()));
            return room.bumpVersion();
        });
        applied(roomId, hostId, "SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}");
        applied(roomId, hostId, "SET_DEALER", "{\"participantId\":\"" + hostId + "\"}");
        applied(roomId, hostId, "START", "{}");
    }

    // 현재 버전으로 명령을 보내고 적용됐는지 확인한다.
    private void applied(String roomId, String who, String type, String payload) {
        RequestOutcome outcome = send(roomId, who, nextSequence(who), read(roomId, Room::version),
                read(roomId, Room::game), type, payload);
        assertThat(outcome.code()).isEqualTo("OK");
    }

    // 실제 서버처럼 방 잠금 안에서 파이프라인을 실행한다.
    private RequestOutcome send(
            String roomId, String who, long sequence, long version, GameState game, String type, String payload) {
        String tournamentId = game == null ? null : game.tournamentId;
        String handId = game == null || game.hand == null ? null : game.hand.id;
        CommandRequest request = new CommandRequest(1, tournamentId, who + "-" + sequence, sequence, 1, version,
                handId, type, CommandFixture.json(payload));
        return registry.withRoom(roomId, room -> pipeline.execute(room, who, request).outcome());
    }

    // 역할별로 규칙상 유효한 명령 종류를 고른다.
    private static String type(String id, List<String> ids, String actor) {
        if (id.equals(actor)) {
            return "CALL";
        }
        return id.equals(ids.get(0)) ? "SCHEDULE_BLINDS" : "FORFEIT";
    }

    // 명령 종류에 맞는 본문을 고른다.
    private static String payload(String id, List<String> ids, String actor) {
        if (id.equals(actor)) {
            return null;
        }
        return id.equals(ids.get(0)) ? "{\"sb\":10,\"bb\":20}" : "{}";
    }

    // 참가자의 다음 순번을 예약한다.
    private long nextSequence(String who) {
        return sequences.merge(who, 1L, Long::sum);
    }

    // 현재 차례인 참가자의 ID를 찾는다.
    private String actor(String roomId) {
        return registry.withRoom(roomId, room -> room.playerIds().entrySet().stream()
                .filter(e -> e.getValue().equals(room.game().hand.actorId))
                .map(Map.Entry::getKey).findFirst().orElseThrow());
    }

    // 잔액과 팟을 합친 칩 총량을 잠금 안에서 구한다.
    private int chips(String roomId) {
        return registry.withRoom(roomId,
                room -> room.game().players.stream().mapToInt((Player p) -> p.stack).sum() + room.game().pot);
    }

    // 방 값을 잠금 안에서 읽는다.
    private <T> T read(String roomId, Function<Room, T> reader) {
        return registry.withRoom(roomId, reader);
    }

    // 모든 스레드가 모일 때까지 기다린다.
    private static void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
