import org.gradle.api.tasks.bundling.AbstractArchiveTask

// Shared settings for every plugin subproject. Dependency versions live in gradle/libs.versions.toml.
subprojects {
    version = "0.1.0"
    dependencyLocking {
        lockAllConfigurations()
    }
}

// Reproducible archives (GE-01w1a): no file timestamps and a fixed entry order, so the same sources give the same jar
// bytes. The plugin-jars lock (plugin/plugin-jars.lock) records those bytes' digests.
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
