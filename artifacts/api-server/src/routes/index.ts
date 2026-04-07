import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fanzaRouter from "./fanza";
import botRouter from "./bot";
import triggerRouter from "./trigger";
import meetingRouter from "./meeting";
import tasksRouter from "./tasks";
import goalsRouter from "./goals";
import quickConfigRouter from "./quick-config";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fanzaRouter);
router.use(botRouter);
router.use(triggerRouter);
router.use(meetingRouter);
router.use(tasksRouter);
router.use(goalsRouter);
router.use(quickConfigRouter);
router.use(authRouter);

export default router;
