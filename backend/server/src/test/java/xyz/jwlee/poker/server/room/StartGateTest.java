package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

// 시작 게이트가 배포 식별자별로 닫히고 열리는지 검사한다
class StartGateTest {

    private final StartGate gate = new StartGate();

    // 새 게이트는 열려 있고 배포 식별자가 없는지 확인한다
    @Test
    void aNewGateIsOpen() {
        assertThat(gate.isClosed()).isFalse();
        assertThat(gate.deploymentId()).isEmpty();
    }

    // 같은 식별자로 다시 닫아도 성공하는지 확인한다
    @Test
    void closingTwiceWithTheSameIdIsIdempotent() {
        assertThat(gate.close("d1")).isTrue();
        assertThat(gate.close("d1")).isTrue();

        assertThat(gate.isClosed()).isTrue();
        assertThat(gate.deploymentId()).contains("d1");
    }

    // 다른 배포가 닫아 둔 게이트는 닫기와 열기가 모두 거절되는지 확인한다
    @Test
    void anotherDeploymentCanNeitherCloseNorOpenIt() {
        gate.close("d1");

        assertThat(gate.close("d2")).isFalse();
        assertThat(gate.open("d2")).isFalse();

        assertThat(gate.deploymentId()).contains("d1");
    }

    // 닫은 배포가 열 수 있고 열린 게이트를 다시 열어도 성공하는지 확인한다
    @Test
    void theClosingDeploymentOpensItAndOpeningAgainIsIdempotent() {
        gate.close("d1");

        assertThat(gate.open("d1")).isTrue();
        assertThat(gate.isClosed()).isFalse();
        assertThat(gate.deploymentId()).isEmpty();
        assertThat(gate.open("d1")).isTrue();
    }
}
