package xyz.jwlee.poker.server.realtime;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

// 전송을 막았다 풀 수 있고 보낸 내용을 기록하는 가짜 소켓
final class FakeSocket implements Connection.Socket {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final long WAIT_SECONDS = 5;

    final List<String> sent = new CopyOnWriteArrayList<>();
    final CompletableFuture<Integer> closedWith = new CompletableFuture<>();
    private final Semaphore entered = new Semaphore(0);
    private volatile CountDownLatch gate = new CountDownLatch(0);
    private volatile boolean failing;

    // 다음 전송부터 풀어 줄 때까지 막는다
    void block() {
        gate = new CountDownLatch(1);
    }

    // 막힌 전송을 푼다
    void release() {
        gate.countDown();
    }

    // 다음 전송부터 입출력 오류를 낸다
    void failSends() {
        failing = true;
    }

    // 전송 하나가 시작될 때까지 기다린다
    void awaitSendStarted() throws InterruptedException {
        if (!entered.tryAcquire(WAIT_SECONDS, TimeUnit.SECONDS)) {
            throw new AssertionError("no send started");
        }
    }

    // 보낸 메시지가 주어진 개수에 이를 때까지 기다린다
    void awaitSent(int count) throws InterruptedException {
        for (int i = 0; i < count; i++) {
            awaitSendStarted();
        }
    }

    // 보낸 메시지 하나를 JSON으로 읽는다
    JsonNode message(int index) {
        return MAPPER.readTree(sent.get(index));
    }

    // 소켓이 닫힐 때까지 기다리고 닫기 코드를 돌려준다
    int awaitClosed() throws Exception {
        return closedWith.get(WAIT_SECONDS, TimeUnit.SECONDS);
    }

    // 보낸 메시지를 기록하거나 설정에 따라 막고 실패시킨다
    @Override
    public void send(String text) throws IOException {
        if (failing) {
            throw new IOException("broken pipe");
        }
        entered.release();
        try {
            gate.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException(e);
        }
        sent.add(text);
    }

    // 닫힌 코드를 기록한다
    @Override
    public void close(int code) {
        closedWith.complete(code);
    }
}
