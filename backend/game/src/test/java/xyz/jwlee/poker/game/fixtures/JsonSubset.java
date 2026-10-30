package xyz.jwlee.poker.game.fixtures;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.util.Map;

/**
 * Subset matching equivalent to Vitest {@code toMatchObject} as documented in the fixture schema:
 * objects compare only the expected keys (recursively), arrays need equal length and match
 * element-wise, scalars compare by equality, and an expected empty object also matches null.
 */
public final class JsonSubset {
    private JsonSubset() {}

    public static void assertMatches(JsonNode expected, JsonNode actual) {
        String mismatch = firstMismatch("$", expected, actual);
        if (mismatch != null) {
            throw new AssertionError(mismatch + "\nexpected: " + expected + "\nactual:   " + actual);
        }
    }

    private static String firstMismatch(String path, JsonNode expected, JsonNode actual) {
        JsonNode exp = expected == null ? NullNode.getInstance() : expected;
        JsonNode act = actual == null || actual.isMissingNode()
                ? NullNode.getInstance()
                : actual;

        if (exp.isObject()) {
            if (exp.isEmpty() && act.isNull()) {
                return null; // Vitest quirk: {} matches null
            }
            if (!act.isObject()) {
                return path + ": expected an object but was " + act.getNodeType();
            }
            for (Map.Entry<String, JsonNode> field : exp.properties()) {
                if (!act.has(field.getKey())) {
                    return path + "." + field.getKey() + ": key is missing";
                }
                String nested = firstMismatch(path + "." + field.getKey(), field.getValue(), act.get(field.getKey()));
                if (nested != null) {
                    return nested;
                }
            }
            return null;
        }
        if (exp.isArray()) {
            if (!act.isArray()) {
                return path + ": expected an array but was " + act.getNodeType();
            }
            if (exp.size() != act.size()) {
                return path + ": expected array length " + exp.size() + " but was " + act.size();
            }
            for (int i = 0; i < exp.size(); i++) {
                String nested = firstMismatch(path + "[" + i + "]", exp.get(i), act.get(i));
                if (nested != null) {
                    return nested;
                }
            }
            return null;
        }
        if (exp.isNumber() && act.isNumber()) {
            return exp.decimalValue().compareTo(act.decimalValue()) == 0
                    ? null
                    : path + ": expected " + exp + " but was " + act;
        }
        return exp.equals(act) ? null : path + ": expected " + exp + " but was " + act;
    }
}
