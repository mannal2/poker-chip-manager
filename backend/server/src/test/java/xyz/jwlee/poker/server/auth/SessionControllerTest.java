package xyz.jwlee.poker.server.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;

@SpringBootTest
@AutoConfigureMockMvc
class SessionControllerTest {

    private static final String ORIGIN = "http://localhost:5173";

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    // 방 한도를 넘지 않도록 만든 방을 지운다
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    @Test
    void theNinthActiveStreamOfASessionIsRefused() throws Exception {
        MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) first.getRequest().getSession(false);
        String csrf = new ObjectMapper().readTree(first.getResponse().getContentAsString())
                .get("csrfToken").asString();

        for (int i = 0; i < 8; i++) {
            mvc.perform(post("/api/session/streams").session(session)
                            .header("X-CSRF-TOKEN", csrf).header("Origin", "http://localhost:5173"))
                    .andExpect(status().isOk());
        }

        mvc.perform(post("/api/session/streams").session(session)
                        .header("X-CSRF-TOKEN", csrf).header("Origin", "http://localhost:5173"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TOO_MANY_STREAMS"));
    }

    // 세션과 CSRF 토큰을 묶어 둔다
    private record Browser(MockHttpSession session, String csrf) { }

    // 새 세션을 연다
    private Browser browser() throws Exception {
        MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
        return new Browser((MockHttpSession) first.getRequest().getSession(false),
                new ObjectMapper().readTree(first.getResponse().getContentAsString()).get("csrfToken").asString());
    }

    // 화면 스트림을 열고 id를 돌려준다
    private String openStream(Browser b) throws Exception {
        MvcResult r = mvc.perform(post("/api/session/streams").session(b.session())
                        .header("X-CSRF-TOKEN", b.csrf()).header("Origin", ORIGIN))
                .andExpect(status().isOk()).andReturn();
        return new ObjectMapper().readTree(r.getResponse().getContentAsString()).get("streamId").asString();
    }

    // 화면 스트림을 닫는다
    private ResultActions closeStream(Browser b, String streamId) throws Exception {
        return mvc.perform(delete("/api/session/streams/" + streamId).session(b.session())
                .header("X-CSRF-TOKEN", b.csrf()).header("Origin", ORIGIN));
    }

    // 주어진 스트림으로 방 생성을 요청한다
    private ResultActions create(Browser b, String streamId) throws Exception {
        return mvc.perform(post("/api/rooms").session(b.session())
                .header("X-CSRF-TOKEN", b.csrf()).header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"protocolVersion\":1,\"streamId\":\"" + streamId
                        + "\",\"requestId\":\"r1\",\"sequence\":1,\"name\":\"Host\"}"));
    }

    @Test
    void aClosedStreamIsUnknownAndItsSlotIsFree() throws Exception {
        Browser b = browser();
        String closed = openStream(b);
        for (int i = 0; i < 7; i++) {
            openStream(b);
        }

        closeStream(b, closed).andExpect(status().isNoContent());

        create(b, closed).andExpect(jsonPath("$.code").value("UNKNOWN_STREAM"));
        openStream(b);
    }

    @Test
    void closingAnUnknownStreamIsNoContent() throws Exception {
        closeStream(browser(), "no-such-stream").andExpect(status().isNoContent());
    }

    @Test
    void closingAnotherSessionsStreamLeavesItOpen() throws Exception {
        Browser owner = browser();
        String streamId = openStream(owner);

        closeStream(browser(), streamId).andExpect(status().isNoContent());

        create(owner, streamId).andExpect(status().isCreated());
    }

    @Test
    void closingAStreamStillNeedsTheCsrfTokenAndAnAllowedOrigin() throws Exception {
        Browser b = browser();
        String streamId = openStream(b);

        mvc.perform(delete("/api/session/streams/" + streamId).session(b.session()).header("Origin", ORIGIN))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_REJECTED"));
        mvc.perform(delete("/api/session/streams/" + streamId).session(b.session())
                        .header("X-CSRF-TOKEN", b.csrf()).header("Origin", "http://evil.example"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ORIGIN_REJECTED"));
        mvc.perform(delete("/api/session/streams/" + streamId).session(b.session()).header("X-CSRF-TOKEN", b.csrf()))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ORIGIN_REJECTED"));

        create(b, streamId).andExpect(status().isCreated());
    }
}
