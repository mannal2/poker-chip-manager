package xyz.jwlee.poker.server.room;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/** Digests used to tell a retry of a request from a different request that reuses its id or sequence. */
public final class Fingerprint {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private Fingerprint() {}

    /** SHA-256 hex of {@code text}: a digest, not the payload, since a ledger keeps 64 of them per stream. */
    public static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Digest of the canonical JSON of type, payload, tournamentId, handId and expectedStateVersion. */
    public static String of(CommandRequest r) {
        ObjectNode n = F.objectNode();
        n.put("type", r.type());
        n.set("payload", r.payload() == null ? F.nullNode() : canonical(r.payload()));
        n.put("tournamentId", r.tournamentId());
        n.put("handId", r.handId());
        n.put("expectedStateVersion", r.expectedStateVersion());
        return sha256(n.toString());
    }

    /** The same JSON with every object's keys in sorted order, so key order never changes the digest. */
    static JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            Map<String, JsonNode> sorted = new TreeMap<>();
            node.properties().forEach(e -> sorted.put(e.getKey(), canonical(e.getValue())));
            ObjectNode out = F.objectNode();
            sorted.forEach(out::set);
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = F.arrayNode();
            node.forEach(e -> out.add(canonical(e)));
            return out;
        }
        return node;
    }
}
