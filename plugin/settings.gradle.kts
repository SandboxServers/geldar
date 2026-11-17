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
        // spark's API (compile-only soft dependency) has no release. This ivy layout points at one exact timestamped
        // file of 0.1-SNAPSHOT, so the version below is a plain version that Gradle verifies against verification-metadata.xml.
        ivy("https://repo.lucko.me") {
            patternLayout { artifact("me/lucko/spark-api/0.1-SNAPSHOT/[module]-[revision](-[classifier]).[ext]") }
            metadataSources { artifact() }
            content { includeModule("me.lucko", "spark-api") }
        }
        mavenCentral()
    }
}

include("core-common")
include("core")
include("velocity-identity")
include("ledger-core")
include("ledger")
