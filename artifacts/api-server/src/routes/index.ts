import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fanzaRouter from "./fanza";
import botRouter from "./bot";
import triggerRouter from "./trigger";
import meetingRouter from "./meeting";
import tasksRouter from "./tasks";
import authRouter from "./auth";
import secretaryRouter from "./secretary";
import safetyRouter from "./safety";
import queueRouter from "./queue";
import analyticsRouter from "./analytics";
import myfansRouter from "./myfans";
import agentRouter from "./agent";
import opsRouter from "./ops";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fanzaRouter);
router.use(botRouter);
router.use(triggerRouter);
router.use(meetingRouter);
router.use(tasksRouter);
router.use(authRouter);
router.use(secretaryRouter);
router.use(safetyRouter);
router.use(queueRouter);
router.use('/analytics', analyticsRouter);
router.use(myfansRouter);
router.use(agentRouter);
router.use(opsRouter);

export default router;
