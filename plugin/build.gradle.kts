import org.gradle.api.tasks.bundling.AbstractArchiveTask

// Shared settings for every plugin subproject. Dependency versions live in gradle/libs.versions.toml.
subprojects {
    version = "0.1.0"
    dependencyLocking {
        lockAllConfigurations()
    }

    // Reproducible archives (GE-01w1a): no file timestamps and a fixed entry order, so the same sources give the same
    // jar bytes. The plugin-jars lock (plugin/plugin-jars.lock) records those bytes' digests. These two settings pin
    // explicitly what Gradle 9 does by default, so a wrapper change cannot silently lose reproducibility.
    tasks.withType<AbstractArchiveTask>().configureEach {
        isPreserveFileTimestamps = false
        isReproducibleFileOrder = true
    }
}
