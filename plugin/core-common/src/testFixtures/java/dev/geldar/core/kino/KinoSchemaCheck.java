package dev.geldar.core.kino;

import com.networknt.schema.Error;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Validates one message against contract/schemas/kino-feed.schema.json. */
final class KinoSchemaCheck {
    private static final String BASE = "https://geldar.dev/schemas/";
    private static final Schema SCHEMA = load();

    private KinoSchemaCheck() {}

    private static Schema load() {
        Path dir = Path.of(System.getProperty("geldar.schemas")).toAbsolutePath().normalize();
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12, builder -> builder
                .schemas(id -> {
                    if (!id.startsWith(BASE)) {
                        return null;
                    }
                    try {
                        return Files.readString(dir.resolve(id.substring(BASE.length())));
                    } catch (IOException e) {
                        throw new UncheckedIOException(e);
                    }
                }));
        return registry.getSchema(SchemaLocation.of(BASE + "kino-feed.schema.json"));
    }

    static List<Error> errors(String json) {
        return SCHEMA.validate(json, InputFormat.JSON);
    }
}