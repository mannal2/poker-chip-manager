package xyz.jwlee.poker.server.room;

import tools.jackson.databind.JsonNode;

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
