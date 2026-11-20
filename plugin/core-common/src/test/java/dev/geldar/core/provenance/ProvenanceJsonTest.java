package dev.geldar.core.provenance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ProvenanceJsonTest {
    private static final String BASE = "https://geldar.dev/schemas/";
    private static final Schema SCHEMA = loadSchema();

    private static Schema loadSchema() {
        Path dir = Path.of(System.getProperty("geldar.schemas")).toAbsolutePath().normalize();
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
                SpecificationVersion.DRAFT_2020_12,
                builder -> builder
                        .schemas(id -> readSchema(dir, id))
                        .schemaRegistryConfig(
                                SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));
        return registry.getSchema(SchemaLocation.of(BASE + "provenance.schema.json"));
    }

    private static String readSchema(Path dir, String id) {
        if (!id.startsWith(BASE)) {
            return null;
        }
        try {
            return Files.readString(dir.resolve(id.substring(BASE.length())));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Test
    void combatBodyHasExactlyTheFiveKeys() {
        JsonObject body = JsonParser.parseString(
                ProvenanceJson.combatJson("world", "ag_kestrel_01", "zombie", "killed", 1234)).getAsJsonObject();

        assertEquals(Set.of("world", "actor", "target", "kind", "tick"), body.keySet());
        assertEquals("world", body.get("world").getAsString());
        assertEquals("ag_kestrel_01", body.get("actor").getAsString());
        assertEquals("zombie", body.get("target").getAsString());
        assertEquals("killed", body.get("kind").getAsString());
        assertEquals(1234L, body.get("tick").getAsLong());
    }

    @Test
    void nullActorIsWrittenAsJsonNull() {
        JsonObject body = JsonParser.parseString(
                ProvenanceJson.combatJson("world", null, "zombie", "engaged", 7)).getAsJsonObject();

        assertTrue(body.has("actor"));
        assertTrue(body.get("actor").isJsonNull());
    }

    @Test
    void namedAndNullActorBodiesValidateAgainstTheProvenanceSchema() {
        assertTrue(SCHEMA.validate(ProvenanceJson.combatJson("world", "ag_kestrel_01", "zombie", "killed", 1234),
                InputFormat.JSON).isEmpty());
        assertTrue(SCHEMA.validate(ProvenanceJson.combatJson("world", null, "zombie", "engaged", 7),
                InputFormat.JSON).isEmpty());
    }

    @Test
    void schemaRejectsAKindOutsideTheEnum() {
        assertFalse(SCHEMA.validate(ProvenanceJson.combatJson("world", null, "zombie", "kill", 7),
                InputFormat.JSON).isEmpty());
    }
}
