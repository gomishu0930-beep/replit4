import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/fanza", async (req, res) => {
  const apiId = process.env.DMM_API_ID;
  const affiliateId = process.env.DMM_AFFILIATE_ID;

  if (!apiId || !affiliateId) {
    res.status(500).json({
      error: "DMM_API_ID と DMM_AFFILIATE_ID を環境変数に設定してください。",
    });
    return;
  }

  const type = String(req.query.type || "rank");
  const kw = String(req.query.kw || "").trim();

  const params = new URLSearchParams({
    api_id: apiId,
    affiliate_id: affiliateId,
    site: "FANZA",
    service: "digital",
    floor: "videoa",
    hits: "10",
    output: "json",
  });

  switch (type) {
    case "rank":
      params.set("sort", "rank");
      break;
    case "new":
      params.set("sort", "date");
      break;
    case "sale":
      params.set("sort", "rank");
      params.set("article", "campaign");
      break;
    case "keyword":
      if (!kw) {
        res.status(400).json({ error: "キーワードを入力してください。" });
        return;
      }
      params.set("sort", "rank");
      params.set("keyword", kw);
      break;
    default:
      res.status(400).json({ error: "不正な検索タイプです。" });
      return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `https://api.dmm.com/affiliate/v3/ItemList?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FanzaGenerator/1.0",
      },
      signal: controller.signal,
    });

    const rawText = await response.text();

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch (_e) {
      res.status(502).json({
        error: "DMM API のレスポンスが JSON ではありません。",
        raw: rawText.slice(0, 500),
      });
      return;
    }

    if (!response.ok) {
      res.status(response.status).json({
        error: "DMM API で HTTP エラーが発生しました。",
        detail: data,
      });
      return;
    }

    const dataObj = data as Record<string, unknown>;
    const result = dataObj?.result as Record<string, unknown> | undefined;
    if (result?.message) {
      res.status(502).json({
        error: result.message,
        detail: data,
      });
      return;
    }

    res.json(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      res.status(504).json({
        error: "DMM API がタイムアウトしました。",
      });
      return;
    }

    res.status(500).json({
      error: "サーバー側で API 取得に失敗しました。",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

export default router;
