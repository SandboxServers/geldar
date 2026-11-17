rootProject.name = "geldar-neoforge-ledger"

// One copy of the pins: the NeoForge build comes from neoforge/gradle.properties (key neoforge.version, read in
// build.gradle.kts) and the ModDevGradle version from neoforge/build.gradle.kts (read here). Nothing is repeated.
pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven.neoforged.net/releases") {
            content { includeGroupAndSubgroups("net.neoforged") }
        }
    }
    plugins {
        val moddevVersion = Regex("""id\("net\.neoforged\.moddev"\)\s+version\s+"([^"]+)"""")
            .find(file("../neoforge/build.gradle.kts").readText())?.groupValues?.get(1)
            ?: error("ModDevGradle version not found in neoforge/build.gradle.kts")
        id("net.neoforged.moddev") version moddevVersion
    }
}
dependencyResolutionManagement {
    // PREFER_PROJECT for the same reason as neoforge/settings.gradle.kts: ModDevGradle adds project repositories.
    repositoriesMode = RepositoriesMode.PREFER_PROJECT
}

// ledger-core is consumed from the Paper plugin build as a composite build (no copy, no publishing). The plugin
// build is not edited; only :ledger-core is used.
includeBuild("../plugin") {
    dependencySubstitution {
        substitute(module("dev.geldar:ledger-core")).using(project(":ledger-core"))
    }
}