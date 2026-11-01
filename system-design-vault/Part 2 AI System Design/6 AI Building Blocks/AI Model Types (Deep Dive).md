---
aliases: [AI Model Types deep dive]
tags: [level/deep-dive, part/2, section/ai-building-blocks]
level: Deep Dive
part: "[[Part 2 AI System Design]]"
section: "[[AI Building Blocks]]"
basics: "[[AI Model Types]]"
reading_time: 8 min
last_verified: 2026-11-01
---
> [!crumbs] [[00 Start Here|🏠 Home]] › [[Part 2 AI System Design|Part 2]] › [[AI Building Blocks]] › [[AI Model Types]] › 🔬 Deep Dive

> [!tldr] For engineers
> Pick the model family from the **shape of the input and output**, then the architecture from the constraints. Text and sequences go to Transformers, pixels to convolutional or residual networks, "what next?" to a two-stage retrieval-and-ranking recommender, future values to forecasting models, and rows of features to gradient-boosted trees. The expensive mistake is reaching for the biggest model when a smaller, specialized one meets the latency and cost budget.

> [!basics]- New to this? Start with the basics
> [[AI Model Types]] explains it with no jargon.

## How it really works

Every model is a learned function from inputs to outputs. **Supervised** models learn from labeled examples and either predict a number (**regression**) or a category (**classification**); **unsupervised** models find structure such as clusters; **reinforcement learning** learns a policy from rewards; **generative** models produce new text, images or audio.[^1] The families below are what those ideas look like in production.

### Language models (NLP and LLMs)

The **Transformer** dropped recurrence and convolution and relies on attention alone, which makes training far more parallel: the original model set a single-model English-to-French translation record of 41.8 BLEU after 3.5 days on eight GPUs.[^2] **Self-attention** lets each token weigh every other token; its cost grows as O(N²·S·D) for N tokens, S layers and D heads, which is why long contexts are expensive.[^3]

Two variants dominate. **Encoder-only** models read bidirectionally and suit classification and embeddings; **decoder-only** models read left to right and generate text one token at a time.[^3] GPT-3, a decoder-only model, has 175 billion parameters, 96 layers and a 2,048-token context window, and was trained on 300 billion tokens.[^4]

### Computer vision

Vision models map pixels to labels, boxes or masks; public hubs group them into image classification, object detection and text-to-image generation.[^5] The key architectural step was **residual learning**: ResNet lets each block learn a correction to its input, which made 152-layer networks trainable, eight times deeper than VGG, and its ensemble reached 3.57% error on ImageNet to win ILSVRC 2015.[^6]

### Recommenders

Recommendation at scale is a **funnel**. YouTube's system uses two neural networks: **candidate generation** cuts millions of videos to hundreds, and **ranking** scores those hundreds with richer features and shows a few dozen.[^7]

Candidate generation is framed as extreme multiclass classification: predict which of millions of videos the user watches next, given a user **embedding** built from watch history and context.[^7] An embedding is a dense, low-dimensional vector that places similar items near each other, replacing sparse one-hot IDs.[^8] Sampling several thousand negative classes instead of computing a full softmax gave more than a 100× training speedup.[^7] The ranker was trained to predict **expected watch time** rather than click probability.[^7]

```python
def recommend(user, k=20):
    u = user_tower(user.history, user.context)           # dense user embedding
    candidates = ann_index.search(u, top_n=500)          # retrieval: millions -> hundreds
    scored = ranker.predict(user, candidates)            # heavier model, more features
    return sorted(scored, key=lambda c: c.score, reverse=True)[:k]
```

### Forecasting

Two schools coexist. **Per-series statistical models** such as Meta's Prophet fit an additive model: a piecewise trend with automatic changepoints, yearly seasonality via Fourier series, weekly seasonality and a holiday list; Meta uses it for capacity planning and goal setting.[^9] **Global deep models** such as DeepAR train one autoregressive recurrent network across many related series and output a probability distribution, reporting about 15% better accuracy than prior methods.[^10]

### Tabular classifiers and regressors

For rows of business features, **gradient-boosted trees** remain the default. Across a 45-dataset benchmark, tree-based models such as XGBoost and random forests stayed state of the art on medium-sized tables of about 10,000 samples; the authors tie the gap partly to neural networks being less robust to uninformative features and worse at learning irregular functions.[^11] Uber's UberEATS delivery-time model, for instance, used gradient-boosted decision tree regression.[^12]

## Design choices and trade-offs

| Family | Typical input → output | Common architecture | Main cost driver |
| --- | --- | --- | --- |
| LLM / NLP | Tokens → tokens or labels | Decoder-only or encoder-only Transformer | Parameters × context length |
| Computer vision | Pixels → labels, boxes | Residual CNN or vision Transformer | Image resolution, frame rate |
| Recommender | User history → ranked items | Two-tower retrieval + ranking network | Catalog size, request rate |
| Forecasting | Past series → future distribution | Additive model or global RNN/Transformer | Number of series, horizon |
| Tabular | Feature row → class or number | Gradient-boosted trees | Feature pipeline, not the model |

| Choice | Gains | Costs |
| --- | --- | --- |
| General LLM via API | Broad skill, no training | Per-token cost, latency, less control |
| Small specialized model | Fast, cheap, predictable | Needs labeled data and upkeep |
| Distilled model | Much of the big model's quality at lower cost | Extra training step; some quality loss |
| One-stage ranking | Simpler system | Cannot score a huge catalog per request |
| Two-stage funnel | Scales to millions of items | Two models to train and keep consistent |
| Heuristic first | Ships today, explainable | Grows unmaintainable as rules pile up |

The last row is Google's advice: don't be afraid to launch without ML, prefer ML over a complex heuristic, and keep the first model simple while getting the infrastructure right.[^13]

## Numbers worth knowing

| Figure | Value |
| --- | --- |
| Original Transformer training (EN→FR) | 3.5 days on 8 GPUs, 41.8 BLEU[^2] |
| GPT-3 | 175B parameters, 96 layers, 2,048-token context, 300B training tokens[^4] |
| Largest Transformers | Hundreds of billions to trillions of parameters[^3] |
| ResNet | 152 layers, 8× deeper than VGG; 3.57% ImageNet test error (ensemble)[^6] |
| YouTube recommender | About 1B parameters, trained on hundreds of billions of examples; funnel of millions → hundreds → dozens[^7] |
| Sampled softmax in YouTube candidate generation | More than 100× speedup over full softmax[^7] |
| DistilBERT vs BERT | 40% smaller, 60% faster, 97% of language understanding retained[^14] |
| Trees vs deep learning on tables | Trees ahead on ~10K-sample datasets across 45 benchmarks[^11] |
| DeepAR | About 15% more accurate than prior state of the art[^10] |

## Failure modes

- **Hallucination and bias.** LLM outputs are often wrong yet fluent, can reflect biases, and are costly to run.[^3] Defend with grounding, guardrails and evaluation sets that target known weak spots.
- **Offline wins that don't ship.** YouTube found live A/B results are not always correlated with offline metrics, so final decisions rely on experiments.[^7]
- **Contaminated benchmarks.** GPT-3's team found test-set overlap in web training data and could not fully remove it because of a filtering bug.[^4] Build private evaluation sets.
- **Long-context blowups.** Quadratic attention makes latency and memory climb fast with prompt length.[^3]
- **Freshness gaps in recommenders.** YouTube's corpus changes with many hours uploaded every second, so models must surface new content quickly.[^7]
- **Regime changes in forecasts.** Trends shift and holidays move demand; Prophet models changepoints and known events explicitly for this reason.[^9]
- **Over-engineering.** A deep model where a heuristic or tree model would do adds cost and fragility.[^13][^11]

## In the real world

- **YouTube**: two-stage deep recommender on TensorFlow, ranked by expected watch time.[^7]
- **OpenAI GPT-3**: decoder-only Transformer that showed strong few-shot results from text prompts alone.[^4]
- **Meta Prophet**: open-source forecasting for capacity planning.[^9]
- **Uber Michelangelo**: gradient-boosted trees for UberEATS delivery times.[^12]
- **Hugging Face Hub**: models organized by task across text, vision, audio, tabular and multimodal.[^5]

## In a design interview

Name the problem type before the model. A clean skeleton:

1. **Frame it:** "This is ranking, not generation: given a user, order the catalog."
2. **Baseline:** "Popularity plus simple rules, so there's a fallback and a bar to beat."
3. **Family and architecture:** "Two-tower retrieval to a few hundred candidates, then a gradient-boosted or neural ranker."
4. **Constraints:** "Under 100 ms per request, so the LLM stays offline, for item descriptions, not in the hot path."
5. **Evaluation:** "Offline recall@k and NDCG, then an A/B test on watch time."

Interviewers probe: *Why not just use an LLM?* (Cost, latency, and tabular data where trees win.) *How do you handle new items?* (Content features and embeddings, not only IDs.) *How big a model do you need?* (Start small; distill if the large one is too slow.)

## 🧱 Builds on

- [[Data Structures (Deep Dive)]] — embeddings are dense vectors in lookup tables keyed by ID, and retrieval is nearest-neighbor search over them.
- [[Trade-offs (Deep Dive)]] — every family choice trades accuracy against latency, cost, data needs and operational complexity.

## Check yourself

> [!question]- Why do large recommenders split retrieval and ranking?
> Scoring millions of items with a rich model per request is too slow. A cheap retrieval model shortlists hundreds with high recall; an expensive ranker orders them with many features.

> [!question]- A team proposes a deep network for a churn model on 8,000 customer rows with 40 features. What do you suggest first?
> A gradient-boosted tree baseline. On medium-sized tabular data, tree models usually match or beat deep learning with less tuning.

> [!question]- Why does doubling prompt length more than double an LLM's attention cost?
> Self-attention compares every token with every other token, so its cost grows with the square of the number of tokens.

## Further reading

- 🔬 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — the paper behind every modern LLM.
- 🔬 [Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/) — the clearest public write-up of a two-stage recommender.
- 🔬 [Why do tree-based models still outperform deep learning on tabular data?](https://arxiv.org/abs/2207.08815) — evidence for the "trees first" rule on tables.
- 🎓 [LLMs: What's a large language model?](https://developers.google.com/machine-learning/crash-course/llm/transformers) — a compact visual walk through Transformers and attention.
- 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — pragmatic advice on when and how to start with ML.

## Related

- [[Model Selection & Training (Deep Dive)]] — choosing and training within a family.
- [[Embeddings & Vector Databases (Deep Dive)]] — the retrieval half of recommenders and RAG.
- [[LLM Inference & Optimization (Deep Dive)]] — serving large language models within budget.
- [[Evaluation & Metrics (Deep Dive)]] — offline metrics versus A/B tests.
- [[Cloud & Infrastructure (Deep Dive)]] — the hardware each family needs.

> [!nav] Keep going
> ← [[Data Sources (Deep Dive)|Data Sources]] · [[AI Building Blocks|🧩 AI Building Blocks]] · [[Cloud & Infrastructure (Deep Dive)|Cloud & Infrastructure]] →
> 🌱 Back to the basics: [[AI Model Types]] · 🗺️ [[Glossary]]

## 📚 Sources

[^1]: 🎓 [What is Machine Learning?](https://developers.google.com/machine-learning/intro-to-ml/what-is-ml) — Google for Developers, Introduction to Machine Learning. Course. Checked 2026-11.
[^2]: 🔬 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) — Vaswani et al., 2017. Paper. Checked 2026-11.
[^3]: 🎓 [LLMs: What's a large language model?](https://developers.google.com/machine-learning/crash-course/llm/transformers) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^4]: 🔬 [Language Models are Few-Shot Learners (PDF)](https://arxiv.org/pdf/2005.14165) — Brown et al., OpenAI, 2020, sections 2.1–2.2. Paper. Checked 2026-11.
[^5]: 📄 [Tasks](https://huggingface.co/tasks) — Hugging Face. Official docs. Checked 2026-11.
[^6]: 🔬 [Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385) — He et al., 2015. Paper. Checked 2026-11.
[^7]: 🔬 [Deep Neural Networks for YouTube Recommendations (PDF)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf) — Covington, Adams and Sargin, Google, ACM RecSys 2016. Paper. Checked 2026-11.
[^8]: 🎓 [Embeddings](https://developers.google.com/machine-learning/crash-course/embeddings) — Google Machine Learning Crash Course. Course. Checked 2026-11.
[^9]: 📝 [Prophet: forecasting at scale](https://research.facebook.com/blog/2017/02/prophet-forecasting-at-scale/) — Meta Research, 2017. Engineering blog. Checked 2026-11.
[^10]: 🔬 [DeepAR: Probabilistic Forecasting with Autoregressive Recurrent Networks](https://arxiv.org/abs/1704.04110) — Salinas et al., 2017. Paper. Checked 2026-11.
[^11]: 🔬 [Why do tree-based models still outperform deep learning on tabular data?](https://arxiv.org/abs/2207.08815) — Grinsztajn, Oyallon and Varoquaux, 2022. Paper. Checked 2026-11.
[^12]: 📝 [Meet Michelangelo: Uber's Machine Learning Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/) — Del Balso and Hermann, Uber Engineering, 2017. Engineering blog. Checked 2026-11.
[^13]: 📄 [Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) — Google for Developers. Official docs. Checked 2026-11.
[^14]: 🔬 [DistilBERT, a distilled version of BERT](https://arxiv.org/abs/1910.01108) — Sanh et al., 2019. Paper. Checked 2026-11.
