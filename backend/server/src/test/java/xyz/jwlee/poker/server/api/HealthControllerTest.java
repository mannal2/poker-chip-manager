package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class HealthControllerTest {

    @Autowired
    MockMvc mvc;

    @Test
    void reportsUpWithProtocolVersionAndBuildVersion() throws Exception {
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.protocolVersion").value(1))
                .andExpect(jsonPath("$.version").isNotEmpty());
    }

    // 이미지의 커밋 값이 있으면 버전으로 알린다
    @Test
    void reportsTheCommitOfTheImage() {
        assertThat(new HealthController(gradleBuild(), "abc123").health()).containsEntry("version", "abc123");
    }

    // 커밋 값이 없으면 빌드 버전을 알린다
    @Test
    void fallsBackToTheBuildVersionWithoutARevision() {
        assertThat(new HealthController(gradleBuild(), " ").health()).containsEntry("version", "0.1.0-TEST");
    }

    // Gradle 빌드 정보를 흉내 낸다
    private static BuildProperties gradleBuild() {
        Properties entries = new Properties();
        entries.setProperty("version", "0.1.0-TEST");
        return new BuildProperties(entries);
    }
}
