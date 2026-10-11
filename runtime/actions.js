// Every human action: the base library plus the two-person and everyday additions (merged here to keep each file small)
import { HUMAN_ACTIONS as BASE } from "./actions-human.js";
import { PAIR_ACTIONS } from "./actions-pair.js";
import { DAILY_ACTIONS } from "./actions-daily.js";

export const HUMAN_ACTIONS = { ...BASE, ...PAIR_ACTIONS, ...DAILY_ACTIONS };
