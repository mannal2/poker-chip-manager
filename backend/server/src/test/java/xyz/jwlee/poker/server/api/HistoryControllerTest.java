package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.server.registry.RoomRegistry;

@SpringBootTest
@AutoConfigureMockMvc
class HistoryControllerTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    /** A started table with hand 1 under way and enough actions taken to have a few events. */
    private GameClient[] table() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "Alice", "Bob", "Carol");
        c[0].send("SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}").andExpect(status().isOk());
        c[0].send("SET_DEALER", "{\"participantId\":\"" + c[0].participantId + "\"}").andExpect(status().isOk());
        c[0].send("START", "{}").andExpect(status().isOk());
        c[0].send("CALL", null).andExpect(status().isOk());
        c[1].send("CALL", null).andExpect(status().isOk());
        c[2].send("CHECK", null).andExpect(status().isOk());
        return c;
    }

    private JsonNode body(org.springframework.test.web.servlet.ResultActions r) throws Exception {
        return GameClient.MAPPER.readTree(r.andReturn().getResponse().getContentAsString());
    }

    @Test
    void historyReturnsTheEventsInOrderWithSequenceNumbers() throws Exception {
        GameClient[] c = table();
        String tournament = c[1].refresh().get("tournamentId").asString();

        JsonNode page = body(c[1].history("?tournamentId=" + tournament).andExpect(status().isOk()));

        JsonNode events = page.get("events");
        assertThat(events.size()).isGreaterThanOrEqualTo(5);
        assertThat(events.get(0).get("sequence").asInt()).isEqualTo(1);
        assertThat(events.get(0).get("type").asString()).isEqualTo("HAND_START");
        assertThat(events.get(0).get("tournamentId").asString()).isEqualTo(tournament);
        for (int i = 0; i < events.size(); i++) {
            assertThat(events.get(i).get("sequence").asInt()).isEqualTo(i + 1);
        }
        assertThat(page.get("nextAfter").asInt()).isEqualTo(events.size());
    }

    @Test
    void theCursorContinuesWhereTheLastPageEnded() throws Exception {
        GameClient[] c = table();
        String tournament = c[0].refresh().get("tournamentId").asString();

        JsonNode first = body(c[0].history("?tournamentId=" + tournament + "&limit=2").andExpect(status().isOk()));
        assertThat(first.get("events").size()).isEqualTo(2);
        assertThat(first.get("nextAfter").asInt()).isEqualTo(2);

        JsonNode next = body(c[0].history("?tournamentId=" + tournament + "&after=2&limit=2")
                .andExpect(status().isOk()));
        assertThat(next.get("events").get(0).get("sequence").asInt()).isEqualTo(3);
        assertThat(next.get("nextAfter").asInt()).isEqualTo(4);

        JsonNode rest = body(c[0].history("?tournamentId=" + tournament + "&after=4").andExpect(status().isOk()));
        int last = rest.get("nextAfter").asInt();
        JsonNode empty = body(c[0].history("?tournamentId=" + tournament + "&after=" + last)
                .andExpect(status().isOk()));
        assertThat(empty.get("events").size()).isZero();
        assertThat(empty.get("nextAfter").asInt()).isEqualTo(last);
        JsonNode beyond = body(c[0].history("?tournamentId=" + tournament + "&after=999").andExpect(status().isOk()));
        assertThat(beyond.get("nextAfter").asInt()).isEqualTo(999);
    }

    @Test
    void theLimitDefaultsTo50AndIsClampedTo100() throws Exception {
        GameClient[] c = table();
        String tournament = c[0].refresh().get("tournamentId").asString();
        // Each accepted SCHEDULE_BLINDS adds one event, so a long list is cheap to make.
        for (int i = 0; i < 110; i++) {
            c[0].send("SCHEDULE_BLINDS", "{\"sb\":5,\"bb\":10}").andExpect(status().isOk());
        }

        JsonNode defaulted = body(c[0].history("?tournamentId=" + tournament).andExpect(status().isOk()));
        JsonNode clamped = body(c[0].history("?tournamentId=" + tournament + "&limit=500").andExpect(status().isOk()));
        JsonNode exact = body(c[0].history("?tournamentId=" + tournament + "&limit=100").andExpect(status().isOk()));

        assertThat(defaulted.get("events").size()).isEqualTo(50);
        assertThat(clamped.get("events").size()).isEqualTo(100);
        assertThat(exact.get("events").size()).isEqualTo(100);
        assertThat(clamped.get("nextAfter").asInt()).isEqualTo(100);
    }

    @Test
    void anotherTournamentIdIs410() throws Exception {
        GameClient[] c = table();

        c[0].history("?tournamentId=someone-elses").andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("TOURNAMENT_CHANGED"));
    }

    @Test
    void aRoomWithoutAGameHasNoHistory() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "Alice", "Bob");

        c[0].history("?tournamentId=anything").andExpect(status().isGone());
    }

    @Test
    void theTournamentIdIsRequiredAndTheCursorMustBeSane() throws Exception {
        GameClient[] c = table();
        String tournament = c[0].refresh().get("tournamentId").asString();

        c[0].history("").andExpect(status().isBadRequest());
        c[0].history("?tournamentId=" + tournament + "&after=-1").andExpect(status().isBadRequest());
        c[0].history("?tournamentId=" + tournament + "&limit=0").andExpect(status().isBadRequest());
        c[0].history("?tournamentId=" + tournament + "&limit=abc").andExpect(status().isBadRequest());
    }

    @Test
    void onlyAParticipantMayReadTheHistory() throws Exception {
        GameClient[] c = table();
        String tournament = c[0].refresh().get("tournamentId").asString();
        GameClient stranger = new GameClient(mvc);
        stranger.roomId = c[0].roomId;

        stranger.history("?tournamentId=" + tournament).andExpect(status().isNotFound());
        mvc.perform(get("/api/rooms/" + c[0].roomId + "/history?tournamentId=" + tournament))
                .andExpect(status().is4xxClientError());
    }

    // 결과 화면에서 나간 사람은 세션에 남은 연결로 기록을 읽을 수 없는지 확인한다.
    @Test
    void someoneWhoLeftOnTheResultScreenCannotReadTheHistory() throws Exception {
        GameClient[] c = table();
        String tournament = c[0].refresh().get("tournamentId").asString();
        c[0].send("ABORT", "{}").andExpect(status().isOk());
        c[1].history("?tournamentId=" + tournament).andExpect(status().isOk());

        c[1].send("LEAVE", "{}").andExpect(status().isOk());

        c[1].history("?tournamentId=" + tournament).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        c[0].history("?tournamentId=" + tournament).andExpect(status().isOk());
    }
}
