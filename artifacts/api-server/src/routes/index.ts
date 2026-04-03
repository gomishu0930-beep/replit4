import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fanzaRouter from "./fanza";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fanzaRouter);

export default router;
