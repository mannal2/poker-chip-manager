package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
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

/** Game commands through the HTTP API, with real sessions: who may act, what a client sees, a multi-hand game. */
@SpringBootTest
@AutoConfigureMockMvc
class GameFlowApiTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    /** Alice (host, seat 0, dealer), Bob, Carol; blinds 5/10; started. */
    private GameClient[] startedTable() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "Alice", "Bob", "Carol");
        c[0].send("SET_SETTINGS", "{\"initial\":1000,\"sb\":5,\"bb\":10}").andExpect(status().isOk());
        c[0].send("SET_DEALER", "{\"participantId\":\"" + c[0].participantId + "\"}").andExpect(status().isOk());
        c[0].send("START", "{}").andExpect(status().isOk())
                .andExpect(jsonPath("$.latestState.roomPhase").value("PLAYING"));
        for (GameClient client : c) {
            client.refresh();
        }
        return c;
    }

    private GameClient actor(GameClient[] c) throws Exception {
        c[0].refresh();
        String actorId = c[0].state.get("game").get("hand").get("actorId").asString();
        for (GameClient client : c) {
            client.refresh();
            if (actorId.equals(client.playerId())) {
                return client;
            }
        }
        throw new AssertionError("nobody is " + actorId);
    }

    @Test
    void startPaysTheBlindsAndTellsOnlyTheActorItsLegalActions() throws Exception {
        GameClient[] c = startedTable();

        assertThat(c[0].state.get("game").get("pot").asInt()).isEqualTo(15);
        assertThat(c[0].state.get("tournamentId").asString()).isEqualTo(c[0].state.get("game").get("tournamentId").asString());
        assertThat(c[0].state.get("you").get("capabilities").get("canAct").asBoolean()).isTrue();
        assertThat(c[0].state.get("legal").get("callAdditional").asInt()).isEqualTo(10);
        assertThat(c[1].state.get("legal").isNull()).isTrue();
        assertThat(c[1].state.get("you").get("capabilities").get("canAct").asBoolean()).isFalse();
    }

    @Test
    void aNonActorIsRefusedEvenWhenThePayloadNamesTheActor() throws Exception {
        GameClient[] c = startedTable();
        long version = c[0].state.get("stateVersion").asLong();

        c[1].send("CALL", "{\"playerId\":\"p0\"}").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_YOUR_TURN"))
                .andExpect(jsonPath("$.outcome").value("REJECTED"));
        c[2].send("RAISE", "{\"playerId\":\"p0\",\"additional\":20}").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_YOUR_TURN"));

        assertThat(c[0].refresh().get("stateVersion").asLong()).isEqualTo(version);
        assertThat(c[0].state.get("game").get("pot").asInt()).isEqualTo(15);
    }

    @Test
    void foldingWithNothingOwedIs422AndAGuestCannotUndo() throws Exception {
        GameClient[] c = startedTable();
        c[0].send("CALL", null).andExpect(status().isOk());
        c[1].send("CALL", null).andExpect(status().isOk());

        c[2].send("FOLD", null).andExpect(status().is(422)).andExpect(jsonPath("$.code").value("INVALID_ACTION"));
        c[1].send("UNDO", "{}").andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void aStaleHandIdIs409() throws Exception {
        GameClient[] c = startedTable();

        c[0].refresh();
        c[0].sendAt("CALL", null, c[0].state.get("stateVersion").asLong(), c[0].tournamentId(), "old-hand")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TOURNAMENT_CHANGED"));
    }

    /** Three players, a whole hand to showdown, a winner, and the next hand with the button moved on. */
    @Test
    void aWholeHandThenTheNextHandWithTheBlindsMoved() throws Exception {
        GameClient[] c = startedTable();
        assertThat(c[0].state.get("game").get("hand").get("buttonSeat").asInt()).isZero();

        // Pre-flop: Alice calls, Bob (small blind) completes, Carol (big blind) checks; then check down.
        c[0].send("CALL", null).andExpect(status().isOk());
        c[1].send("CALL", null).andExpect(status().isOk());
        c[2].send("CHECK", null).andExpect(status().isOk());
        for (int guard = 0; guard < 12; guard++) {
            c[0].refresh();
            if (!"betting".equals(c[0].state.get("game").get("hand").get("phase").asString())) {
                break;
            }
            actor(c).send("CHECK", null).andExpect(status().isOk());
        }
        c[0].refresh();
        JsonNode hand = c[0].state.get("game").get("hand");
        assertThat(hand.get("phase").asString()).isEqualTo("settlement");
        assertThat(c[0].state.get("you").get("capabilities").get("canSettle").asBoolean()).isTrue();
        assertThat(c[1].state.get("you").get("capabilities").get("canSettle").asBoolean()).isFalse();

        // Everyone sees the host's draft; the room version does not move for it.
        long version = c[0].state.get("stateVersion").asLong();
        c[0].send("SETTLEMENT_DRAFT", "{\"potIndex\":0,\"winners\":{\"pot0\":[\"p1\"]}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.resultStateVersion").value(version))
                .andExpect(jsonPath("$.latestState.settlementDraft.draftVersion").value(1));
        assertThat(c[2].refresh().get("settlementDraft").get("winners").get("pot0").get(0).asString()).isEqualTo("p1");

        c[0].send("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}").andExpect(status().isOk())
                .andExpect(jsonPath("$.latestState.settlementDraft").value((Object) null));

        c[0].refresh();
        JsonNode game = c[0].state.get("game");
        assertThat(game.get("hand").get("number").asInt()).isEqualTo(2);
        assertThat(game.get("hand").get("buttonSeat").asInt()).isEqualTo(1);
        assertThat(game.get("hand").get("sbSeat").asInt()).isEqualTo(2);
        assertThat(game.get("hand").get("bbSeat").asInt()).isZero();
        assertThat(game.get("players").get(1).get("stack").asInt()).isEqualTo(1020);
        assertThat(game.get("pot").asInt()).isEqualTo(15);
        assertThat(c[0].state.get("roomPhase").asString()).isEqualTo("PLAYING");
    }

    @Test
    void aGuestForfeitsAndStaysInTheRoomWhileTheHostMustHandOverFirst() throws Exception {
        GameClient[] c = startedTable();

        c[0].send("FORFEIT", "{}").andExpect(status().is(422)).andExpect(jsonPath("$.code").value("TRANSFER_HOST_FIRST"));
        c[1].send("FORFEIT", "{}").andExpect(status().isOk());

        assertThat(c[0].refresh().get("participants").size()).isEqualTo(3);
        assertThat(c[0].state.get("game").get("players").get(1).get("forfeited").asBoolean()).isTrue();
    }

    @Test
    void afterReReadyTheOldTournamentIdIs409ForCommandsAndGoneForHistory() throws Exception {
        GameClient[] c = startedTable();
        String old = c[0].tournamentId();
        String oldHand = c[0].handId();
        c[0].send("ABORT", "{}").andExpect(status().isOk());

        c[1].send("RE_READY", "{}").andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        c[0].send("RE_READY", "{}").andExpect(status().isOk())
                .andExpect(jsonPath("$.latestState.roomPhase").value("WAITING"))
                .andExpect(jsonPath("$.latestState.tournamentId").value((Object) null));

        c[0].refresh();
        c[0].sendAt("CALL", null, c[0].state.get("stateVersion").asLong(), old, oldHand)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TOURNAMENT_CHANGED"));
        c[0].history("?tournamentId=" + old).andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("TOURNAMENT_CHANGED"));
    }

    @Test
    void reReadyDuringAGameIs422AbortFirst() throws Exception {
        GameClient[] c = startedTable();

        c[0].send("RE_READY", "{}").andExpect(status().is(422)).andExpect(jsonPath("$.code").value("ABORT_FIRST"));
    }
}
