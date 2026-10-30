package xyz.jwlee.poker.server.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
class SessionControllerTest {

    @Autowired
    MockMvc mvc;

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
}
