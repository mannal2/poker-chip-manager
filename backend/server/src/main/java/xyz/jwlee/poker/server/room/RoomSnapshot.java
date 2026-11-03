package xyz.jwlee.poker.server.room;

import tools.jackson.databind.node.ObjectNode;

// 한 요청자 시점의 방 상태 JSON과 그 시점의 버전
/** A room's state as one requester sees it: the JSON body and the state version it was taken at. */
public record RoomSnapshot(ObjectNode json, long stateVersion) { }
