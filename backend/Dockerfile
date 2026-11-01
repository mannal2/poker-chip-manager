FROM eclipse-temurin:25-jdk AS build

WORKDIR /app/backend

COPY . .

RUN ./gradlew --no-daemon :server:bootJar

FROM eclipse-temurin:25-jre

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
