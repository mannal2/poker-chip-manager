package xyz.jwlee.poker.server.room;

import java.util.Optional;

// 배포가 진행되는 동안 새 게임 시작을 막는 서버 전체 게이트
/**
 * Closed by one deployment at a time. The field is volatile because commands read it under a room lock while a
 * deployment writes it under the global lock; {@code RoomRegistry.prepareDeployment} relies on that ordering.
 * Nothing here reopens by itself: only the deployment that closed the gate can open it.
 */
public final class StartGate {

    private volatile String closedBy;

    // 게이트가 닫혀 있는지 돌려준다
    public boolean isClosed() {
        return closedBy != null;
    }

    // 게이트를 닫아 둔 배포의 식별자를 돌려준다
    public Optional<String> deploymentId() {
        return Optional.ofNullable(closedBy);
    }

    // 게이트를 닫고 다른 배포가 닫아 둔 상태면 false를 돌려준다
    public synchronized boolean close(String id) {
        if (closedBy != null && !closedBy.equals(id)) {
            return false;
        }
        closedBy = id;
        return true;
    }

    // 게이트를 열고 다른 배포가 닫아 둔 상태면 false를 돌려준다
    public synchronized boolean open(String id) {
        if (closedBy != null && !closedBy.equals(id)) {
            return false;
        }
        closedBy = null;
        return true;
    }
}
