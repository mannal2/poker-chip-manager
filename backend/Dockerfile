FROM eclipse-temurin:25.0.5_8-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS build

WORKDIR /app/backend

COPY . .

RUN ./gradlew --no-daemon :server:bootJar

FROM eclipse-temurin:25.0.5_8-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0

ARG REVISION=unknown

LABEL org.opencontainers.image.revision="$REVISION"

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin poker

COPY --from=build /app/backend/server/build/libs/server-*.jar /app/app.jar

ENV SPRING_PROFILES_ACTIVE=prod
ENV POKER_BUILD_REVISION="$REVISION"

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
