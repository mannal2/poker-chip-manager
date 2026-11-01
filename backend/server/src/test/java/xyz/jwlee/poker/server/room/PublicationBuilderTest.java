package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class PublicationBuilderTest {

    // 수집 결과를 연결 ID별 메시지로 펼친다
    private static Map<String, ObjectNode> messages(Publication publication) {
        Map<String, ObjectNode> out = new TreeMap<>();
        publication.deliveries().forEach(d -> assertThat(out.put(d.connectionId(), d.message())).isNull());
        return out;
    }

    // 메시지의 이벤트 번호를 차례로 모은다
    private static List<Long> sequences(JsonNode message) {
        List<Long> out = new ArrayList<>();
        message.get("events").forEach(e -> out.add(e.get("sequence").asLong()));
        return out;
    }

    // 명령 하나로 구독자마다 자기 시점 메시지가 하나씩 생기고 다시 모으면 비어 있는지 확인한다
    @Test
    void oneCommandGivesEachSubscriberOneMessageInTheirOwnViewAndThenNothing() {
        CommandFixture f = new CommandFixture(3);
        f.room.presence().attach("a", "conn-a2", f.room.createdAt());
        PublicationBuilder.collect(f.room);

        f.send("a", "SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}");
        Map<String, ObjectNode> messages = messages(PublicationBuilder.collect(f.room));

        assertThat(messages).containsOnlyKeys("conn-a", "conn-a2", "conn-b", "conn-c");
        messages.values().forEach(m -> {
            assertThat(m.get("type").asString()).isEqualTo("SNAPSHOT");
            assertThat(m.get("state").get("stateVersion").asLong()).isEqualTo(f.room.version());
        });
        assertThat(messages.get("conn-a").get("state").get("you").get("participantId").asString()).isEqualTo("a");
        assertThat(messages.get("conn-a2").get("state").get("you").get("participantId").asString()).isEqualTo("a");
        assertThat(messages.get("conn-b").get("state").get("you").get("participantId").asString()).isEqualTo("b");
        assertThat(messages.get("conn-c").get("state").get("you").get("participantId").asString()).isEqualTo("c");
        assertThat(PublicationBuilder.collect(f.room).isEmpty()).isTrue();
    }

    // 이벤트 번호가 기록 조회와 같고 이전 버전이 직전 수집 버전인지 확인한다
    @Test
    void eventsCarryTheHistorySequenceAndPreviousVersionIsTheLastCollectedOne() {
        GameFixture f = GameFixture.started(2, 0);
        PublicationBuilder.collect(f.room);
        long before = f.room.version();
        int alreadySeen = f.room.events().size();

        f.check(f.send(f.actor(), "CALL", null));
        f.check(f.send(f.actor(), "CHECK", null));
        ObjectNode message = messages(PublicationBuilder.collect(f.room)).get("conn-a");

        assertThat(message.get("previousVersion").asLong()).isEqualTo(before);
        assertThat(message.get("state").get("stateVersion").asLong()).isEqualTo(f.room.version());
        assertThat(sequences(message).getFirst()).isEqualTo(alreadySeen + 1L);
        assertThat(sequences(message).getLast()).isEqualTo((long) f.room.events().size());
        for (JsonNode event : message.get("events")) {
            long sequence = event.get("sequence").asLong();
            assertThat(event).isEqualTo(EventView.write(f.room.events().get((int) sequence - 1), sequence));
        }
    }

    // 승자 초안 저장은 상태 버전을 유지하고 초안 버전만 올린 메시지를 보내는지 확인한다
    @Test
    void aSettlementDraftKeepsTheStateVersionAndStillGoesOut() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send(f.actor(), "CALL", null));
        f.checkDown();
        PublicationBuilder.collect(f.room);
        long version = f.room.version();

        f.check(f.send("a", "SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p0\"]}}"));
        Map<String, ObjectNode> messages = messages(PublicationBuilder.collect(f.room));

        assertThat(f.room.version()).isEqualTo(version);
        assertThat(messages).containsOnlyKeys("conn-a", "conn-b");
        ObjectNode message = messages.get("conn-b");
        assertThat(message.get("previousVersion").asLong()).isEqualTo(version);
        assertThat(message.get("events")).isEmpty();
        assertThat(message.get("state").get("stateVersion").asLong()).isEqualTo(version);
        assertThat(message.get("state").get("draftVersion").asLong()).isEqualTo(1);
    }

    // 초안이 없는 방의 상태에도 초안 버전이 들어 있는지 확인한다
    @Test
    void theStateAlwaysCarriesTheDraftVersion() {
        CommandFixture f = new CommandFixture(1);

        ObjectNode message = messages(PublicationBuilder.collect(f.room)).get("conn-a");

        assertThat(message.get("state").get("draftVersion").asLong()).isZero();
    }

    // 취소 메시지에 UNDO 이벤트가 들어 있는지 확인한다
    @Test
    void anUndoMessageCarriesTheUndoEvent() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send(f.actor(), "CALL", null));
        PublicationBuilder.collect(f.room);

        f.check(f.send("a", "UNDO", "{}"));
        ObjectNode message = messages(PublicationBuilder.collect(f.room)).get("conn-b");

        assertThat(message.get("events")).hasSize(1);
        assertThat(message.get("events").get(0).get("type").asString()).isEqualTo("UNDO");
    }

    // 내보낸 사람의 연결은 끊을 목록에 들어가고 스냅샷은 받지 않는지 확인한다
    @Test
    void aKickedPersonIsRevokedAndGetsNoSnapshot() {
        CommandFixture f = new CommandFixture(3);
        f.room.presence().attach("b", "conn-b2", f.room.createdAt());
        PublicationBuilder.collect(f.room);

        f.send("a", "KICK", "{\"participantId\":\"b\"}");
        Publication publication = PublicationBuilder.collect(f.room);

        assertThat(publication.revokedConnections()).containsExactlyInAnyOrder("conn-b", "conn-b2");
        assertThat(messages(publication)).containsOnlyKeys("conn-a", "conn-c");
        assertThat(publication.goneConnections()).isEmpty();
        assertThat(PublicationBuilder.collect(f.room).revokedConnections()).isEmpty();
    }

    // 방이 닫히면 남은 연결은 사라진 방 목록에 들어가고 스냅샷은 없는지 확인한다
    @Test
    void aClosedRoomSendsItsRemainingConnectionsAwayWithoutASnapshot() {
        CommandFixture f = new CommandFixture(2);
        PublicationBuilder.collect(f.room);
        f.room.bumpVersion();
        f.room.requestSnapshot("conn-a");
        f.room.close();

        Publication publication = PublicationBuilder.collect(f.room);

        assertThat(publication.goneConnections()).containsExactlyInAnyOrder("conn-a", "conn-b");
        assertThat(publication.deliveries()).isEmpty();
        assertThat(publication.revokedConnections()).isEmpty();
    }

    // 메시지를 만들다 실패해도 끊을 연결과 스냅샷 요청이 다음 수집까지 남는지 확인한다
    @Test
    void aFailedBuildLosesNeitherRevocationsNorSnapshotRequests() {
        CommandFixture f = new CommandFixture(3);
        PublicationBuilder.collect(f.room);
        f.send("a", "KICK", "{\"participantId\":\"b\"}");
        f.room.requestSnapshot("conn-a");
        f.room.events().add(null);

        assertThatThrownBy(() -> PublicationBuilder.collect(f.room)).isInstanceOf(RuntimeException.class);

        f.room.events().removeLast();
        Publication publication = PublicationBuilder.collect(f.room);
        assertThat(publication.revokedConnections()).containsExactly("conn-b");
        assertThat(messages(publication).get("conn-a").get("previousVersion").isNull()).isTrue();
    }

    // 마지막 사람이 나가 방이 닫혀도 그 사람의 연결이 끊을 목록에 들어가는지 확인한다
    @Test
    void theLastPersonLeavingIsRevokedEvenThoughTheRoomClosed() {
        CommandFixture f = new CommandFixture(1);
        PublicationBuilder.collect(f.room);

        f.send("a", "LEAVE", "{}");
        Publication publication = PublicationBuilder.collect(f.room);

        assertThat(f.room.isClosed()).isTrue();
        assertThat(publication.revokedConnections()).containsExactly("conn-a");
        assertThat(publication.goneConnections()).isEmpty();
        assertThat(publication.deliveries()).isEmpty();
    }

    // 스냅샷 요청은 버전 변화 없이 그 연결에만 이전 버전 없는 빈 이벤트 메시지를 보내는지 확인한다
    @Test
    void aRequestedSnapshotGoesToThatConnectionAloneWithoutHistory() {
        GameFixture f = GameFixture.started(2, 0);
        PublicationBuilder.collect(f.room);
        long version = f.room.version();

        f.room.requestSnapshot("conn-b");
        f.room.requestSnapshot("no-such-connection");
        Map<String, ObjectNode> messages = messages(PublicationBuilder.collect(f.room));

        assertThat(f.room.version()).isEqualTo(version);
        assertThat(messages).containsOnlyKeys("conn-b");
        ObjectNode message = messages.get("conn-b");
        assertThat(message.get("type").asString()).isEqualTo("SNAPSHOT");
        assertThat(message.get("previousVersion").isNull()).isTrue();
        assertThat(message.get("events")).isEmpty();
        assertThat(message.get("state").get("you").get("participantId").asString()).isEqualTo("b");
        assertThat(PublicationBuilder.collect(f.room).isEmpty()).isTrue();
    }

    // 변경과 스냅샷 요청이 겹치면 요청한 연결은 처음 받는 형태의 메시지 하나만 받는지 확인한다
    @Test
    void aSubscriberAskingDuringAChangeGetsOneMessageWithoutHistory() {
        GameFixture f = GameFixture.started(2, 0);
        PublicationBuilder.collect(f.room);
        long before = f.room.version();

        f.check(f.send(f.actor(), "CALL", null));
        f.room.requestSnapshot("conn-b");
        Map<String, ObjectNode> messages = messages(PublicationBuilder.collect(f.room));

        assertThat(messages.get("conn-b").get("previousVersion").isNull()).isTrue();
        assertThat(messages.get("conn-b").get("events")).isEmpty();
        assertThat(messages.get("conn-a").get("previousVersion").asLong()).isEqualTo(before);
        assertThat(messages.get("conn-a").get("events")).isNotEmpty();
    }

    // 다음 토너먼트의 이벤트는 번호가 1부터 다시 시작하는지 확인한다
    @Test
    void aNewTournamentStartsItsEventsFromSequenceOne() {
        GameFixture f = GameFixture.started(2, 0);
        f.check(f.send("a", "ABORT", "{}"));
        PublicationBuilder.collect(f.room);

        f.check(f.send("a", "RE_READY", "{}"));
        assertThat(messages(PublicationBuilder.collect(f.room)).get("conn-a").get("events")).isEmpty();
        f.check(f.send("a", "SET_DEALER", "{\"participantId\":\"a\"}"));
        f.check(f.send("a", "START", "{}"));
        ObjectNode message = messages(PublicationBuilder.collect(f.room)).get("conn-a");

        assertThat(sequences(message).getFirst()).isEqualTo(1L);
        assertThat(sequences(message)).hasSize(f.room.events().size());
    }
}
