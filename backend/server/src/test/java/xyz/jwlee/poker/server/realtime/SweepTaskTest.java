package xyz.jwlee.poker.server.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.RoomPublisher;
import xyz.jwlee.poker.server.support.IdGenerator;

// 설정값에 따라 방 점검 작업이 켜지고 꺼지는지 검사한다
class SweepTaskTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(RoomRegistry.class,
                    () -> new RoomRegistry(IdGenerator.random(), Clock.systemUTC(), new RoomPublisher.Silent()))
            .withUserConfiguration(SweepTask.class);

    @Test
    void theSweepRunsUnlessItIsSwitchedOff() {
        runner.withPropertyValues("poker.sweep.enabled=").withSystemProperties("poker.sweep.enabled=")
                .run(context -> assertThat(context).hasSingleBean(SweepTask.class));
        runner.withPropertyValues("poker.sweep.enabled=true")
                .run(context -> assertThat(context).hasSingleBean(SweepTask.class));
        runner.withPropertyValues("poker.sweep.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(SweepTask.class));
    }
}
