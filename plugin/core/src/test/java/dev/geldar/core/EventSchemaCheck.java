package dev.geldar.core;

import com.networknt.schema.Error;
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
import java.util.List;

/** Validates envelopes against contract/schemas/event.schema.json, resolving common.schema.json from disk. */
final class EventSchemaCheck {
    private static final String BASE = "https://geldar.dev/schemas/";
    private static final Schema SCHEMA = load();

    private EventSchemaCheck() {}

    private static Schema load() {
        Path dir = Path.of(System.getProperty("geldar.schemas")).toAbsolutePath().normalize();
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
                SpecificationVersion.DRAFT_2020_12,
                builder -> builder
                        .schemas(id -> read(dir, id))
                        // Without this, "format": "date-time" is an annotation and a bad timestamp passes.
                        .schemaRegistryConfig(
                                SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));
        return registry.getSchema(SchemaLocation.of(BASE + "event.schema.json"));
    }

    /** The schema text for a geldar.dev schema id, read from the contract directory; null for other ids. */
    private static String read(Path dir, String id) {
        if (!id.startsWith(BASE)) {
            return null;
        }
        try {
            return Files.readString(dir.resolve(id.substring(BASE.length())));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Schema errors for the envelope; empty when valid. */
    static List<Error> errors(EventEnvelope event) {
        return errors(event.toJson().toString());
    }

    /** Schema errors for a raw JSON document; empty when valid. */
    static List<Error> errors(String json) {
        return SCHEMA.validate(json, InputFormat.JSON);
    }
}
