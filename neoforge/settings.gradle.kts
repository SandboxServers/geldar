rootProject.name = "geldar-neoforge"

pluginManagement {
    repositories {
        gradlePluginPortal()
        // The ModDevGradle plugin is also published on the NeoForged maven; only the net.neoforged groups come from it.
        maven("https://maven.neoforged.net/releases") {
            content { includeGroupAndSubgroups("net.neoforged") }
        }
    }
}

dependencyResolutionManagement {
    // PREFER_PROJECT, not FAIL_ON_PROJECT_REPOS as in plugin/: ModDevGradle 2.0.148 adds its own repositories
    // (Mojang libraries and meta, NeoForged, Minecraft Forge for mergetool) to the project. FAIL_ON_PROJECT_REPOS
    // refuses them and PREFER_SETTINGS ignores them, which breaks createMinecraftArtifacts (checked 2026-11-16).
    repositoriesMode = RepositoriesMode.PREFER_PROJECT
    repositories {
        // NeoForge's own artifacts come from the NeoForged maven, for its groups only; everything else from Central.
        maven("https://maven.neoforged.net/releases") {
            content { includeGroupAndSubgroups("net.neoforged") }
        }
        mavenCentral()
    }
}
