package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

// 방 하나의 기기 복구 신청을 보관하고 상태를 바꾼다
/**
 * The room's recovery requests. Which session asked is not kept here: the id is remembered in that session, so a
 * snapshot cannot carry it. A request that ended stays for one more lifetime, so a device that lost the answer can
 * read it again. Not thread-safe: the caller holds the room lock and bumps the version.
 */
public final class RecoveryRequests {

    static final int MAX_PER_SEAT = 3;

    // 신청의 상태
    public enum Status { PENDING, APPROVED, REJECTED, EXPIRED, SUPERSEDED }

    // 신청 한 건. credential은 승인된 뒤에만 값이 있고 신청한 세션에게만 건넨다
    public record Request(String id, String participantId, Instant requestedAt, Instant expiresAt, Status status,
            Instant endedAt, String credential) {

        // 대기 중 시간이 지난 신청은 쓸기 전이어도 만료로 본다
        public Status statusAt(Instant now) {
            return status == Status.PENDING && !now.isBefore(expiresAt) ? Status.EXPIRED : status;
        }

        // 상태를 끝난 값으로 바꾼 사본을 만든다
        private Request ended(Status next, Instant now, String issued) {
            return new Request(id, participantId, requestedAt, expiresAt, next, now, issued);
        }
    }

    private final Map<String, Request> requests = new LinkedHashMap<>();

    // 자리의 대기 신청이 한도 안이면 새 신청을 더한다
    Request add(String id, String participantId, Instant now) {
        long waiting = requests.values().stream().filter(r -> r.participantId().equals(participantId)
                && r.statusAt(now) == Status.PENDING).count();
        if (waiting >= MAX_PER_SEAT) {
            throw new RoomException("RECOVERY_LIMIT");
        }
        Request request = new Request(id, participantId, now, now.plus(RoomLifecycle.RECOVERY_REQUEST_LIFETIME),
                Status.PENDING, null, null);
        requests.put(id, request);
        return request;
    }

    // ID로 신청을 찾는다
    public Optional<Request> find(String id) {
        return Optional.ofNullable(requests.get(id));
    }

    // 대기 중인 신청을 들어온 순서로 돌려준다
    List<Request> pending() {
        return requests.values().stream().filter(r -> r.status() == Status.PENDING).toList();
    }

    // 신청을 승인으로 끝내고 같은 자리의 다른 대기 신청을 밀어낸다
    void approve(Request request, String credential, Instant now) {
        requests.put(request.id(), request.ended(Status.APPROVED, now, credential));
        supersede(request.participantId(), now);
    }

    // 자리의 대기 신청을 모두 밀어낸다
    void supersede(String participantId, Instant now) {
        for (Request other : pending()) {
            if (other.participantId().equals(participantId)) {
                requests.put(other.id(), other.ended(Status.SUPERSEDED, now, null));
            }
        }
    }

    // 신청을 거절로 끝낸다
    void reject(Request request, Instant now) {
        requests.put(request.id(), request.ended(Status.REJECTED, now, null));
    }

    // 시간이 지난 대기 신청을 만료시키고 끝난 지 오래된 신청을 지운 뒤, 만료가 있었으면 true를 돌려준다
    boolean sweep(Instant now) {
        requests.values().removeIf(r -> r.endedAt() != null
                && !now.isBefore(r.endedAt().plus(RoomLifecycle.RECOVERY_REQUEST_LIFETIME)));
        List<Request> expired = pending().stream().filter(r -> r.statusAt(now) == Status.EXPIRED).toList();
        expired.forEach(r -> requests.put(r.id(), r.ended(Status.EXPIRED, now, null)));
        return !expired.isEmpty();
    }
}
