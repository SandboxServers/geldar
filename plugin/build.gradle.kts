// Shared settings for every plugin subproject. Dependency versions live in gradle/libs.versions.toml.
subprojects {
    version = "0.1.0"
    dependencyLocking {
        lockAllConfigurations()
    }
}
