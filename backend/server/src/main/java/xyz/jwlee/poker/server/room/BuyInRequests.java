package xyz.jwlee.poker.server.room;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

// 방 하나의 바이인 신청(새 사람과 탈락자의 재입장)을 보관하고 상태를 바꾼다
/**
 * The room's buy-in requests. {@code askedBy} names who asked (a session id for a newcomer, the participant id for a
 * re-entry) only to hold each asker to {@link #MAX_PER_ASKER} pending requests; it is never published. A request
 * belongs to the tournament it was made in, so a new tournament never seats it. A request that ended stays for one
 * more lifetime, so a device that lost the answer can read it again. Not thread-safe: the caller holds the room lock
 * and bumps the version.
 */
public final class BuyInRequests {

    static final int MAX_PER_ASKER = RecoveryRequests.MAX_PER_SEAT;

    // 신청의 상태
    public enum Status { PENDING, APPROVED, REJECTED, EXPIRED, SUPERSEDED }

    // 신청 한 건. 새 사람의 participantId와 credential은 승인된 뒤에만 값이 있고 credential은 신청한 세션에게만 건넨다
    /** {@code reentryOf} is the eliminated player id of a re-entry, null for a newcomer. */
    public record Request(String id, String askedBy, String tournamentId, String name, String reentryOf,
            String participantId, Instant requestedAt, Instant expiresAt, Status status, Instant endedAt,
            String credential) {

        // 대기 중 시간이 지난 신청은 쓸기 전이어도 만료로 본다
        public Status statusAt(Instant now) {
            return status == Status.PENDING && !now.isBefore(expiresAt) ? Status.EXPIRED : status;
        }

        // 상태를 끝난 값으로 바꾼 사본을 만든다
        private Request ended(Status next, Instant now, String seat, String issued) {
            return new Request(id, askedBy, tournamentId, name, reentryOf, seat, requestedAt, expiresAt, next, now,
                    issued);
        }
    }

    private final Map<String, Request> requests = new LinkedHashMap<>();

    // 신청한 쪽의 대기 신청이 한도 안이면 새 신청을 더한다
    Request add(String id, String askedBy, String tournamentId, String name, String reentryOf, String participantId,
            Instant now) {
        long waiting = requests.values().stream().filter(r -> r.askedBy().equals(askedBy)
                && r.statusAt(now) == Status.PENDING).count();
        if (waiting >= MAX_PER_ASKER) {
            throw new RoomException(ErrorCode.BUY_IN_LIMIT);
        }
        Request request = new Request(id, askedBy, tournamentId, name, reentryOf, participantId, now,
                now.plus(RoomLifecycle.RECOVERY_REQUEST_LIFETIME), Status.PENDING, null, null);
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

    // 신청을 승인으로 끝내고, 재입장이면 같은 참가자의 다른 대기 신청을 밀어낸다
    /** {@code credential} is null for a re-entry: that participant keeps the seat it already holds. */
    void approve(Request request, String participantId, String credential, Instant now) {
        requests.put(request.id(), request.ended(Status.APPROVED, now, participantId, credential));
        if (request.reentryOf() != null) {
            supersede(participantId, now);
        }
    }

    // 참가자가 낸 대기 재입장 신청을 모두 밀어낸다
    void supersede(String participantId, Instant now) {
        for (Request other : pending()) {
            if (participantId.equals(other.participantId())) {
                requests.put(other.id(), other.ended(Status.SUPERSEDED, now, other.participantId(), null));
            }
        }
    }

    // 대기 중인 신청을 모두 밀어낸다(토너먼트가 끝나 더는 받을 수 없을 때)
    void supersedeAllPending(Instant now) {
        for (Request other : pending()) {
            requests.put(other.id(), other.ended(Status.SUPERSEDED, now, other.participantId(), null));
        }
    }

    // 신청을 거절로 끝낸다
    void reject(Request request, Instant now) {
        requests.put(request.id(), request.ended(Status.REJECTED, now, request.participantId(), null));
    }

    // 시간이 지난 대기 신청을 만료시키고 끝난 지 오래된 신청을 지운 뒤, 만료가 있었으면 true를 돌려준다
    boolean sweep(Instant now) {
        requests.values().removeIf(r -> r.endedAt() != null
                && !now.isBefore(r.endedAt().plus(RoomLifecycle.RECOVERY_REQUEST_LIFETIME)));
        List<Request> expired = pending().stream().filter(r -> r.statusAt(now) == Status.EXPIRED).toList();
        expired.forEach(r -> requests.put(r.id(), r.ended(Status.EXPIRED, now, r.participantId(), null)));
        return !expired.isEmpty();
    }
}
