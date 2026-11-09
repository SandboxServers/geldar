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
        mavenCentral()
    }
}

include("core")
include("velocity-identity")