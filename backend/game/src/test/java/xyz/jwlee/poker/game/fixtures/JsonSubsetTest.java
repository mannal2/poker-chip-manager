package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class JsonSubsetTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static void assertMatches(String expected, String actual) {
        JsonSubset.assertMatches(json(expected), json(actual));
    }

    @Test
    void objectMatchesWhenExpectedKeysAreASubset() {
        assertThatCode(() -> assertMatches("{\"a\":1}", "{\"a\":1,\"b\":2}")).doesNotThrowAnyException();
    }

    @Test
    void nestedObjectsAreComparedRecursively() {
        assertThatCode(() -> assertMatches("{\"a\":{\"b\":1}}", "{\"a\":{\"b\":1,\"c\":2},\"d\":3}"))
                .doesNotThrowAnyException();
    }

    @Test
    void arraysMatchElementWiseWithSubsetObjects() {
        assertThatCode(() -> assertMatches("[{}, {\"x\":1}]", "[{\"y\":0}, {\"x\":1}]")).doesNotThrowAnyException();
    }

    @Test
    void arraysOfDifferentLengthFail() {
        assertThatThrownBy(() -> assertMatches("[1]", "[1,2]")).isInstanceOf(AssertionError.class);
    }

    @Test
    void differingScalarsFail() {
        assertThatThrownBy(() -> assertMatches("{\"a\":1}", "{\"a\":2}")).isInstanceOf(AssertionError.class);
    }

    @Test
    void missingExpectedKeyFails() {
        assertThatThrownBy(() -> assertMatches("{\"a\":1}", "{\"b\":1}")).isInstanceOf(AssertionError.class);
    }

    @Test
    void errorMessageNamesThePath() {
        assertThatThrownBy(() -> assertMatches("{\"a\":[{\"b\":1}]}", "{\"a\":[{\"b\":2}]}"))
                .hasMessageContaining("$.a[0].b");
    }

    @Test
    void emptyExpectedObjectAlsoMatchesNull() {
        // Mirrors Vitest toMatchObject: fixtures rely on {} matching null.
        assertThatCode(() -> assertMatches("{\"undo\":{}}", "{\"undo\":null}")).doesNotThrowAnyException();
        assertThatCode(() -> assertMatches("{}", "null")).doesNotThrowAnyException();
    }

    @Test
    void nonEmptyExpectedObjectDoesNotMatchNull() {
        assertThatThrownBy(() -> assertMatches("{\"a\":1}", "null")).isInstanceOf(AssertionError.class);
    }

    @Test
    void expectedNullOnlyMatchesNull() {
        assertThatCode(() -> assertMatches("null", "null")).doesNotThrowAnyException();
        assertThatThrownBy(() -> assertMatches("null", "{}")).isInstanceOf(AssertionError.class);
    }

    @Test
    void numbersCompareByValueAcrossRepresentations() {
        assertThatCode(() -> assertMatches("1", "1.0")).doesNotThrowAnyException();
    }
}
