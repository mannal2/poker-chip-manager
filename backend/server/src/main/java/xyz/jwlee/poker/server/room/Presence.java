package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

// 참가자별 구독 연결과 끊김 시각을 기록한다
/**
 * Who is connected right now. A participant is connected while at least one valid subscription connection is
 * attached (C2); closing one of several connections changes nothing. Not thread-safe: the caller holds the
 * room lock. It keeps no version: the caller bumps the room state version on each reported transition.
 */
public final class Presence {

    // 참가자 한 명의 연결 기록
    private static final class Record {
        private boolean everConnected;
        private Instant absentSince;
        private final List<String> connections = new ArrayList<>();

        // 참가자 기록 하나를 접속 시작 시각으로 만든다
        private Record(Instant joinedAt) {
            this.absentSince = joinedAt;
        }
    }

    private final Map<String, Record> records = new HashMap<>();
    private final Map<String, String> subscribers = new LinkedHashMap<>();

    // 새 참가자를 접속한 적 없는 상태로 기록한다
    public void joined(String participantId, Instant now) {
        records.put(participantId, new Record(now));
    }

    // 연결을 붙이고 끊김에서 접속으로 바뀌었으면 true를 돌려준다
    public boolean attach(String participantId, String connectionId, Instant now) {
        Record record = records.get(participantId);
        if (record == null || subscribers.containsKey(connectionId)) {
            return false;
        }
        boolean transition = record.connections.isEmpty();
        record.connections.add(connectionId);
        record.everConnected = true;
        record.absentSince = null;
        subscribers.put(connectionId, participantId);
        return transition;
    }

    // 연결을 떼고 마지막 연결이 끊겨 접속에서 끊김으로 바뀌었으면 true를 돌려준다
    public boolean detach(String connectionId, Instant now) {
        String participantId = subscribers.remove(connectionId);
        Record record = participantId == null ? null : records.get(participantId);
        if (record == null) {
            return false;
        }
        record.connections.remove(connectionId);
        if (!record.connections.isEmpty()) {
            return false;
        }
        record.absentSince = now;
        return true;
    }

    // 참가자가 지금 접속 중인지 확인한다
    public boolean isConnected(String participantId) {
        Record record = records.get(participantId);
        return record != null && !record.connections.isEmpty();
    }

    // 끊긴 시각을 돌려주고 접속 중이거나 모르는 사람이면 빈 값을 돌려준다
    public Optional<Instant> absentSince(String participantId) {
        Record record = records.get(participantId);
        return record == null ? Optional.empty() : Optional.ofNullable(record.absentSince);
    }

    // 참가 이후 한 번도 접속하지 않았는지 확인한다
    public boolean neverConnected(String participantId) {
        Record record = records.get(participantId);
        return record != null && !record.everConnected;
    }

    // 참가자의 현재 연결 수를 돌려준다
    public int connectionCount(String participantId) {
        Record record = records.get(participantId);
        return record == null ? 0 : record.connections.size();
    }

    // 연결 ID에서 참가자 ID로 가는 복사본을 돌려준다
    public Map<String, String> subscribers() {
        return Map.copyOf(subscribers);
    }

    // 참가자의 기록을 지우고 그 사람의 연결 ID를 돌려준다
    public List<String> forget(String participantId) {
        Record record = records.remove(participantId);
        if (record == null) {
            return List.of();
        }
        record.connections.forEach(subscribers::remove);
        return List.copyOf(record.connections);
    }

    // 끊긴 사람의 끊김 시각만 지금으로 다시 정한다
    public void restartAbsence(Instant now) {
        records.values().stream().filter(r -> r.connections.isEmpty()).forEach(r -> r.absentSince = now);
    }
}
