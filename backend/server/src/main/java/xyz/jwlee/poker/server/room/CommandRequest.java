package xyz.jwlee.poker.server.room;

import tools.jackson.databind.JsonNode;

// 클라이언트가 보낸 방 명령 한 건(순번, 조작권 세대, 기대 버전, 종류, payload)
/**
 * One room command as the client sent it, envelope already checked for shape. {@code tournamentId},
 * {@code handId} and {@code payload} are null when absent.
 */
public record CommandRequest(
        int protocolVersion,
        String tournamentId,
        String requestId,
        long sequence,
        long controlGeneration,
        long expectedStateVersion,
        String handId,
        String type,
        JsonNode payload) { }
