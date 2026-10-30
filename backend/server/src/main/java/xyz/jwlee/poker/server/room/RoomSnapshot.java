package xyz.jwlee.poker.server.room;

import tools.jackson.databind.node.ObjectNode;

/** A room's state as one requester sees it: the JSON body and the state version it was taken at. */
public record RoomSnapshot(ObjectNode json, long stateVersion) { }
