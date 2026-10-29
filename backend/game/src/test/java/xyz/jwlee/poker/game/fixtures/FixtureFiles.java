package xyz.jwlee.poker.game.fixtures;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Locates and loads the shared rule-case files in {@code shared/game-fixtures}. */
public final class FixtureFiles {
    static final Set<String> SUITES =
            Set.of("settings", "positions", "betting", "pots", "settlement", "lifecycle", "undo", "forfeit");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private FixtureFiles() {}

    /** Directory from the {@code fixtures.dir} system property, else {@code ../../shared/game-fixtures}. */
    static Path directory() {
        String configured = System.getProperty("fixtures.dir");
        Path dir = configured != null ? Path.of(configured) : Path.of("..", "..", "shared", "game-fixtures");
        return dir.toAbsolutePath().normalize();
    }

    /** Loads every case of one suite file, in file order. */
    public static List<JsonNode> load(String suite) {
        if (!SUITES.contains(suite)) {
            throw new IllegalArgumentException("Unknown fixture suite: " + suite);
        }
        Path file = directory().resolve(suite + ".json");
        try {
            JsonNode root = MAPPER.readTree(Files.readString(file));
            if (!root.isArray()) {
                throw new IllegalStateException(file + " must contain a JSON array");
            }
            List<JsonNode> cases = new ArrayList<>();
            root.forEach(cases::add);
            return cases;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read fixture file " + file, e);
        }
    }
}
