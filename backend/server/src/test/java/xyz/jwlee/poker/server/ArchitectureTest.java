package xyz.jwlee.poker.server;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = "xyz.jwlee.poker.server", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    @ArchTest
    static final ArchRule roomAndRegistryDoNotDependOnApiOrAuth =
            noClasses().that().resideInAnyPackage("..server.room..", "..server.registry..")
                    .should().dependOnClassesThat().resideInAnyPackage("..server.api..", "..server.auth..");

    @ArchTest
    static final ArchRule roomAndRegistryDoNotDependOnWebOrServlet =
            noClasses().that().resideInAnyPackage("..server.room..", "..server.registry..")
                    .should().dependOnClassesThat().resideInAnyPackage(
                            "org.springframework.web..", "org.springframework.http..", "jakarta.servlet..");

    @ArchTest
    static final ArchRule supportDoesNotDependOnOtherServerPackages =
            noClasses().that().resideInAPackage("..server.support..")
                    .should().dependOnClassesThat().resideInAnyPackage(
                            "..server.api..", "..server.auth..", "..server.room..", "..server.registry..");
}
