rootProject.name = "geldar-plugin"

pluginManagement {
    repositories {
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        // The Paper repository serves only the Paper and Velocity groups (exclusiveContent), and those groups
        // are never looked up elsewhere; everything else comes from Central.
        exclusiveContent {
            forRepository { maven("https://repo.papermc.io/repository/maven-public/") }
            filter {
                includeGroupAndSubgroups("io.papermc")
                includeGroup("com.mojang")
                includeGroup("net.md-5")
                includeGroup("com.velocitypowered")
            }
        }
        // CoreProtect (block owner queries) comes from its own repository, for its group only.
        maven("https://maven.playpro.com") {
            content { includeGroup("net.coreprotect") }
        }
        // BlueMap's API (skin provider) comes from the BlueMap repository, for its group only.
        maven("https://repo.bluecolored.de/releases") {
            content { includeGroup("de.bluecolored") }
        }
        mavenCentral()
    }
}

include("core")
include("velocity-identity")
include("ledger-core")
include("ledger")
