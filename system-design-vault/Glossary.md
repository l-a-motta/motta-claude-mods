---
tags: [reference]
aliases: [dictionary, terms, definitions, A-Z]
---
> [!crumbs] [[00 Start Here|🏠 Home]] › Glossary

> [!tip] 477 terms, A to Z
> Each term has a one-line, plain-English definition and an arrow to the note that explains it. Press **Ctrl/Cmd + F** to find a word on this page.

**Jump to:** [[#A|A]] · [[#B|B]] · [[#C|C]] · [[#D|D]] · [[#E|E]] · [[#F|F]] · [[#G|G]] · [[#H|H]] · [[#I|I]] · [[#J|J]] · [[#K|K]] · [[#L|L]] · [[#M|M]] · [[#N|N]] · [[#O|O]] · [[#P|P]] · [[#Q|Q]] · [[#R|R]] · [[#S|S]] · [[#T|T]] · [[#U|U]] · [[#V|V]] · [[#W|W]]

## A

- **A/B test** — A live experiment that shows two versions to random groups of users and compares how each group behaves. → [[Evaluation & Metrics]]
- **ACID** — Atomicity, consistency, isolation and durability: the four guarantees a transactional database makes about its changes. → [[Databases]]
- **Adversarial example** — An input changed slightly and deliberately so that a model gives a wrong answer with high confidence. → [[AI Security & Privacy]]
- **AES** — The Advanced Encryption Standard, the fast, widely used cipher where the same secret key locks and unlocks data. → [[Encryption]]
- **Agent loop** — The repeating cycle of decide, act, observe and decide again that an AI agent follows. → [[AI Agents & Tool Use]]
- **AI agent** — A language model that works in a loop, choosing actions, seeing their results and deciding the next step until a goal is met. → [[AI Agents & Tool Use]]
- **AI Agents & Tool Use** — Models that plan, call tools and take steps toward a goal.
- **AI Architecture Layers** — The four layers every AI system has: data, model, serving, monitoring.
- **AI Model Types** — The main families of models and what each is good for.
- **AI Monitoring & Observability** — Watching a live model for quality drops, drift and surprises.
- **AI Reliability & Fault Tolerance** — Keeping AI features working when models, GPUs or providers fail.
- **AI Scalability & Distributed Systems** — Spreading AI training and serving across many machines and chips.
- **AI Security & Privacy** — Protecting models, data and users from attacks and leaks.
- **AI System Design Overview** — What makes designing an AI system different from any other system.
- **Alert** — An automatic message to an engineer that fires when a metric crosses a line someone set. → [[Metrics]]
- **All-reduce** — A step where many machines combine their numbers, such as averaging, and all receive the same result. → [[AI Scalability & Distributed Systems]]
- **Alternatives considered** — The section of a design doc listing other designs that were weighed and why they were rejected. → [[High-Level Design]]
- **Anycast** — A routing method where many data centers share one internet address and each user automatically reaches a nearby one. → [[CDN]]
- **API** — A set of agreed rules that lets one program ask another for data or actions. → [[API Design]]
- **API Design** — Designing the contract other programs use to talk to yours.
- **API gateway** — A single front door that receives requests from apps and routes or combines them across the right backend services. → [[Microservices]]
- **API versioning** — Labeling changes to an API so existing clients keep getting the old behavior until they choose to upgrade. → [[API Design]]
- **Approximate nearest neighbor (ANN)** — Search that finds almost-certainly-closest vectors by checking only part of the data, trading a little accuracy for big speed. → [[Embeddings & Vector Databases]]
- **Architecture decision record (ADR)** — A short document recording one design decision, its context and its consequences, so later teams know why it was made. → [[Trade-offs]]
- **Array** — A numbered row of items stored side by side, so you can jump straight to any position. → [[Data Structures]]
- **Async** — Starting slow work, like a network call, and doing other things until its result arrives instead of waiting idle. → [[Concurrency]]
- **Asynchronous replication** — The leader confirms changes immediately and copies them in the background: faster, but recent changes can be lost. → [[Replication]]
- **At-least-once delivery** — A guarantee that every message arrives, but some may arrive more than once, so consumers must handle duplicates. → [[Message Queues]]
- **Attribute-based access control (ABAC)** — Access rules that check facts about the user, the item and the situation, such as department, owner or time of day. → [[Authorization]]
- **Authentication** — Proving who someone is.
- **Authentication (AuthN)** — Proving to a system that you are who you claim to be, for example with a password, phone or fingerprint. → [[Authentication]]
- **Authorization** — Deciding what someone is allowed to do.
- **Authorization (AuthZ)** — Deciding what a known user or program is allowed to do, such as reading, editing or deleting a specific item. → [[Authorization]]
- **Autoscaling** — Automatically adding or removing machines or copies of a service as demand rises and falls. → [[AI Scalability & Distributed Systems]]
- **Availability** — The property that a system keeps answering requests, even when some of its parts have failed. → [[Trade-offs]]
- **Availability (CAP)** — Every request that reaches a working server eventually gets an answer, even if it might be out of date. → [[CAP Theorem]]
- **AWS Lambda** — Amazon's serverless service that runs your functions in response to events and bills per request and run time. → [[Serverless]]

## B

- **Back-of-the-envelope estimate** — Quick, rough math using simple assumptions and known numbers to size a system before building it. → [[Estimation]]
- **Backend (target)** — One of the servers behind a load balancer that actually does the work for a request. → [[Load Balancing]]
- **Bandwidth** — How much data a connection can carry per second; more bandwidth does not shorten a single round trip. → [[Networking]]
- **Base62** — Writing numbers using the 62 characters a-z, A-Z and 0-9, giving short codes that are safe in web addresses. → [[Case Studies]]
- **Baseline** — The simple, often non-AI solution a model must clearly beat to be worth building and maintaining. → [[Business Goals & Requirements]]
- **Batch inference** — Running a model over a large pile of data at once, with no live service, such as nightly scoring. → [[Deployment & Serving]]
- **Batch ingestion** — Moving data in large chunks on a schedule, such as a nightly copy of a database. → [[Data Sources]]
- **Batch processing** — Handling data in large scheduled chunks, such as once every night. → [[Data Engineering & Pipelines]]
- **Batch vs real-time inference** — Computing predictions ahead of time and storing them, versus computing each prediction the moment it is requested. → [[AI Architecture Layers]]
- **Bias** — An AI system systematically treating some groups of people worse than others. → [[Ethics & Governance]]
- **Big ball of mud** — Slang for a codebase with no clear structure, where everything depends on everything else and changes break unrelated parts. → [[Monoliths]]
- **Big O notation** — Shorthand for how an algorithm's time or memory grows as its input grows, such as O(1), O(log n) or O(n). → [[Data Structures]]
- **Bloom filter** — A tiny structure that says an item is definitely absent or probably present, trading a small error rate for much less memory. → [[Data Structures]]
- **BM25** — A classic keyword-ranking formula that scores documents by matching terms; strong at exact names and codes. → [[Retrieval-Augmented Generation]]
- **Bottleneck** — The part of a system that slows everything down first when traffic grows. → [[High-Level Design]]
- **Breaking change** — A change to an API, such as renaming or removing a field, that makes existing client code stop working. → [[API Design]]
- **Broken access control** — A bug that lets someone see or change data they shouldn't, like viewing another user's account by changing an ID. → [[Authorization]]
- **Bucket** — A container that holds objects in an object storage service such as Amazon S3. → [[Object Storage]]
- **Business goal** — The result an organization wants from a project, stated in plain words, such as fewer fraud losses. → [[Business Goals & Requirements]]
- **Business Goals & Requirements** — Starting from the problem and the people, not from the model.

## C

- **C4 model** — A simple way to draw software architecture at four zoom levels: system context, containers, components and code. → [[High-Level Design]]
- **Cache hit / cache miss** — A hit means the edge already had the file and answered at once; a miss means it had to fetch it from the origin. → [[CDN]]
- **Caching** — Keeping a copy of frequently used data somewhere faster.
- **Canary release** — Giving a new version to a small share of users first, then widening it or rolling back. → [[Deployment & Serving]]
- **CAP Theorem** — When the network breaks, a system must choose: stay correct or stay up.
- **Capacity planning** — Deciding how many servers, how much storage and how much network capacity a system needs, including spare room. → [[Estimation]]
- **Capstone - AI Support Assistant** — Designing an AI customer-support assistant end to end, step by step.
- **Cardinality** — How many distinct label combinations a metric has; each one is a separate series that costs memory. → [[Metrics]]
- **Cascading failure** — A failure that spreads as overloaded parts push their work onto others, which then fail too. → [[Fault Tolerance]]
- **Case Studies** — Classic systems designed step by step, applying everything above.
- **CDN** — Servers around the world that hand out content close to each user.
- **CDN (content delivery network)** — A network of servers around the world that keeps copies of a website's files close to users so they load faster. → [[CDN]]
- **Certificate** — A digital document, signed by a trusted authority, proving that a public key really belongs to a particular website. → [[Encryption]]
- **Change data capture (CDC)** — Copying every insert, update and delete from a database as it happens, by reading the database's own change log. → [[Data Sources]]
- **Checkpoint** — A saved snapshot of training progress, so a job can restart after a failure without starting over. → [[AI Scalability & Distributed Systems]]
- **Chunking** — Splitting long documents into short passages so each can be indexed and retrieved on its own. → [[Retrieval-Augmented Generation]]
- **CI/CD** — Continuous integration and delivery: automatically testing every change, then shipping it to users safely and repeatably. → [[MLOps & CI-CD]]
- **Circuit breaker** — A safety switch that stops calling a failing service for a while and fails fast instead. → [[Fault Tolerance]]
- **Class** — A template or blueprint for creating objects of one kind. Each object built from it is called an instance. → [[Object-Oriented Programming]]
- **Class diagram** — A drawing that shows a program's classes, what each holds and does, and how they relate to each other. → [[Low-Level Design]]
- **Cloud & Infrastructure** — The machines, chips and cloud services AI runs on.
- **Cloud computing** — Renting computing power, storage and networking over the internet on demand, and releasing it when finished. → [[Cloud & Infrastructure]]
- **Codebase** — The full set of source code files that make up a program. → [[Monoliths]]
- **Cold start** — The extra delay when the platform must set up a fresh environment before running a function for the first time. → [[Serverless]]
- **Compaction** — Replacing older parts of a long conversation with a short summary so the work can continue within the context window. → [[Context Engineering]]
- **Computer vision** — AI that understands images and video, for example naming objects in a photo or finding where they are. → [[AI Model Types]]
- **Concept drift** — When the link between inputs and the correct answer changes, so a model's learned lessons stop being true. → [[AI Monitoring & Observability]]
- **Concurrency** — Doing many things at once without the pieces tripping over each other.
- **Consistency** — The property that every user sees the same, most recent data, no matter which copy they read from. → [[Trade-offs]]
- **Consistency (CAP)** — Every read sees the most recent write, as if there were only one copy of the data. → [[CAP Theorem]]
- **Consistent hashing** — A way to place data on a ring of machines so adding or removing one moves only a small share of data. → [[Sharding]]
- **Consumer** — The part of a system that takes messages from a queue and does the work they describe. → [[Message Queues]]
- **Container** — A group of ordinary processes given their own isolated view of the system, using Linux namespaces, with resource limits from cgroups. → [[Operating Systems]]
- **Content moderation** — Automatically scoring text or images for harmful content, such as hate or violence, so it can be flagged or blocked. → [[Guardrails & AI Safety]]
- **Context Engineering** — Deciding exactly what goes into a model's input so it answers well.
- **Context propagation** — Passing the trace ID and related data along with each call from one service to the next. → [[Distributed Tracing]]
- **Context rot** — The drop in a model's accuracy at finding and using information as its input grows longer. → [[Context Engineering]]
- **Context window** — The most text, counted in tokens, that an AI model can handle in one request, including its own answer. → [[Context Engineering]]
- **Continuous batching** — Serving many requests together where finished ones leave and new ones join at every step, so the GPU never sits idle. → [[LLM Inference & Optimization]]
- **Continuous training** — Automatically retraining and redeploying a model on fresh data, a need unique to machine learning systems. → [[AI System Design Overview]]
- **Cosine similarity** — A measure of how closely two vectors point in the same direction; the usual way to compare text embeddings. → [[Embeddings & Vector Databases]]
- **Cost Optimization** — Getting the same results for less money.
- **CRUD** — Create, read, update, delete: the four basic actions on stored data. → [[REST]]
- **CSAT** — Customer satisfaction score, usually collected with a short survey after a support conversation. → [[Capstone - AI Support Assistant]]
- **Cursor** — An opaque bookmark returned with a page of results that tells the server where the next page starts. → [[API Design]]

## D

- **Dashboard** — A screen of live charts built from metrics that shows a system's health at a glance. → [[Metrics]]
- **Data drift** — When the data a model sees in real use gradually changes from the data it learned from. → [[AI Monitoring & Observability]]
- **Data Engineering & Pipelines** — Moving and cleaning data so models get a steady, trustworthy supply.
- **Data ingestion** — Collecting data from apps, databases and devices into your system so it can be processed. → [[Data Engineering & Pipelines]]
- **Data lake** — A central store of raw data of every kind, kept as-is and structured only when analyzed. → [[Object Storage]]
- **Data layer** — The part of an AI system that collects, cleans and turns raw data into features a model can learn from. → [[AI Architecture Layers]]
- **Data leakage** — Building a model with information that will not exist at prediction time, which makes test scores look falsely good. → [[Feature Engineering]]
- **Data parallelism** — Each GPU holds a full copy of the model and trains on a different slice of the data. → [[AI Scalability & Distributed Systems]]
- **Data pipeline** — An automatic chain of steps that collects data, cleans it and delivers it where it is needed, again and again. → [[Data Engineering & Pipelines]]
- **Data poisoning** — Slipping harmful or misleading examples into the data a model learns from, so it learns the wrong behavior. → [[AI Security & Privacy]]
- **Data source** — Any system or place an AI system gets data from, such as databases, APIs, event streams, files or devices. → [[Data Sources]]
- **Data Sources** — Where an AI system's data comes from: databases, APIs, streams, files, devices.
- **Data structure** — A way of arranging data in a computer's memory so that the questions you ask most often are fast to answer. → [[Data Structures]]
- **Data Structures** — Ways of arranging data so the right questions are fast to answer.
- **Data validation** — Automatic checks that incoming data has the expected types, ranges and patterns before a model uses it. → [[Data Engineering & Pipelines]]
- **Database** — A system that stores data so it survives crashes and lets many users query and change it safely. → [[Databases]]
- **Databases** — Systems that store data safely and let you query it later.
- **DAU (daily active users)** — The number of different people who use a product on a given day; a common starting point for estimates. → [[Estimation]]
- **Dead-letter queue** — A side queue that collects messages that failed processing too many times, so engineers can inspect them. → [[Message Queues]]
- **Deadline** — The longest time a caller will wait for a reply before giving up on the call. → [[gRPC]]
- **Deadlock** — Tasks stuck forever because each is waiting for something another one holds and won't release. → [[Concurrency]]
- **Deflection rate** — The share of customer questions the assistant solves without any human help. → [[Capstone - AI Support Assistant]]
- **Deny by default** — A safety rule: if no policy explicitly allows an action, the system refuses it. → [[Authorization]]
- **Dependency injection** — Handing an object the things it needs, usually through its constructor, instead of letting it create or look them up. → [[Design Patterns]]
- **Deployable unit** — The package of software that gets put live in one go. A monolith has exactly one. → [[Monoliths]]
- **Deployment & Serving** — Putting a trained model where users and apps can call it.
- **Design doc** — A short document written before coding that explains a planned system, its goals and the trade-offs behind it. → [[High-Level Design]]
- **Design pattern** — A named, proven blueprint for solving a design problem that keeps recurring in software, adapted to each program. → [[Design Patterns]]
- **Design Patterns** — Named, reusable solutions to problems that keep coming up in code.
- **Differential privacy** — A mathematical guarantee that limits how much anyone can learn about one person from a dataset or its statistics. → [[AI Security & Privacy]]
- **Distributed monolith** — Services that are split apart but still must be deployed together, getting the downsides of both styles. → [[Microservices]]
- **Distributed Tracing** — Following one request as it hops across many services.
- **DNS** — The Domain Name System, the Internet's address book that turns names like a website domain into IP addresses. → [[Networking]]
- **Document database** — A database that stores flexible, nested, JSON-like records; records in one collection need not share the same fields. → [[NoSQL Databases]]
- **Durability** — How unlikely a storage service is to lose your data; S3 is designed for eleven nines. → [[Object Storage]]
- **Dynamic batching** — Grouping separate incoming requests on the server so the hardware processes them together, raising throughput. → [[Deployment & Serving]]

## E

- **Edge server (PoP)** — A CDN location in a city near users that hands out cached copies of content. PoP stands for point of presence. → [[CDN]]
- **ELK stack** — Elasticsearch, Logstash and Kibana: a popular toolkit to collect, store, search and chart logs. → [[Logging]]
- **ELT** — Extract, load, transform: store raw data in the destination first, then clean and reshape it there later. → [[Data Engineering & Pipelines]]
- **Embedding** — A list of numbers produced by an AI model that captures what a piece of text, image or audio means. → [[Embeddings & Vector Databases]]
- **Embeddings & Vector Databases** — Turning meaning into numbers so you can search by similarity.
- **Encapsulation** — Keeping an object's inner details private so other code can only use it through its public actions. → [[Object-Oriented Programming]]
- **Encryption** — Scrambling data so only the right people can read it.
- **Encryption at rest / in transit** — At rest protects stored data on disks and backups; in transit protects data while it travels across networks. → [[Encryption]]
- **Endpoint** — One specific address where an API accepts a certain kind of request. → [[API Design]]
- **Envelope encryption** — Encrypting data with its own key, then locking that key with a master key kept in a secure key service. → [[Encryption]]
- **Error budget** — The amount of failure an SLO allows, such as 0.1% of requests at 99.9%, which teams can spend before slowing releases. → [[Requirements]]
- **Escalation (handoff)** — Passing a customer conversation from the AI assistant to a human agent, usually for hard or risky cases. → [[Capstone - AI Support Assistant]]
- **Estimation** — Quick math that tells you how big the problem really is.
- **Ethics & Governance** — Making AI fair, explainable, lawful and accountable.
- **ETL** — Extract, transform, load: copy data out of a source, clean and reshape it, then store it in its destination. → [[Data Engineering & Pipelines]]
- **EU AI Act** — The European Union's law that regulates AI systems according to their level of risk, with bans and strict rules for high-risk uses. → [[Ethics & Governance]]
- **Eval** — A test that gives an AI system an input and uses grading rules to score its output. → [[Evaluation & Metrics]]
- **Evaluation & Metrics** — Measuring whether a model is actually good, before and after launch.
- **Event loop** — A single thread that runs small pieces of code one at a time as events, like finished network calls, arrive. → [[Concurrency]]
- **Event stream** — A continuous flow of small records describing things that just happened, such as clicks, payments or sensor readings. → [[Data Sources]]
- **Eventual consistency** — A guarantee that copies of data may briefly differ but will all match once updates stop arriving. → [[Trade-offs]]
- **Excessive agency** — Giving an AI agent more tools, permissions or freedom than its task needs, so a mistake or attack causes real damage. → [[AI Agents & Tool Use]]
- **Experiment tracking** — Logging every training run's settings, scores and resulting model so results can be compared and reproduced. → [[Model Selection & Training]]
- **Explainability** — Being able to show which factors drove an AI decision, so people can understand and question it. → [[Ethics & Governance]]
- **Exponential backoff** — Retrying a failed request while waiting longer after each failure, for example doubling the wait each time. → [[Fault Tolerance]]

## F

- **F1 score** — A single number that balances precision and recall, useful when one class is rare. → [[Evaluation & Metrics]]
- **FaaS (functions as a service)** — A serverless model where you upload small functions that the platform runs automatically when a chosen event happens. → [[Serverless]]
- **Factory** — A pattern where one piece of code decides which kind of object to create, so callers don't hard-code it. → [[Design Patterns]]
- **Failover** — Promoting a follower to become the new leader when the old leader stops responding. → [[Replication]]
- **Fairness metric** — A measurable rule for comparing how an AI treats different groups, such as equal approval rates or equal error rates. → [[Ethics & Governance]]
- **Fallback** — A backup model, provider or region that takes over a request when the main one fails. → [[AI Reliability & Fault Tolerance]]
- **False positive / false negative** — A false alarm versus a missed case; requirements should say which mistake hurts users more. → [[Business Goals & Requirements]]
- **Fan-out** — Copying one new post into many followers' ready-made feeds at once, so reading a feed is fast. → [[Case Studies]]
- **Fault Tolerance** — Designing so that when something breaks, the system keeps going.
- **Feature** — One measurable input a model uses to make a prediction, such as rides taken in the last seven days. → [[Feature Engineering]]
- **Feature cross** — A new feature made by combining two or more features, letting simple models spot patterns that appear together. → [[Feature Engineering]]
- **Feature Engineering** — Turning raw data into the signals a model can learn from.
- **Feature store** — A shared library of model inputs that keeps history for training and fresh values for fast answers, so both match. → [[AI Architecture Layers]]
- **Few-shot prompting** — Putting a few worked examples in the model's input so it copies their pattern, without retraining the model. → [[Context Engineering]]
- **Fine-tuning** — A short extra round of training that adapts a pre-trained model to your specific task or style. → [[Model Selection & Training]]
- **FinOps** — The practice of engineering, finance and business teams sharing cloud and AI cost data to get the most value per dollar. → [[Cost Optimization]]
- **Forecasting model** — A model that predicts future numbers, like sales or website visits, from past values and patterns such as seasons. → [[AI Model Types]]
- **Foreign key** — A column in one table that points to the primary key of another table, linking the two. → [[SQL Databases]]
- **Functional requirement** — A statement of something a system must do, such as letting users post a photo or reset a password. → [[Requirements]]

## G

- **Gang of Four (GoF)** — Nickname for the four authors of the 1994 book Design Patterns, which cataloged 23 patterns. → [[Design Patterns]]
- **GB-second** — The billing unit for function run time: the memory given to a function, in gigabytes, multiplied by seconds it ran. → [[Serverless]]
- **GIL (Global Interpreter Lock)** — A lock in standard Python that lets only one thread run Python code at a time; now optional in newer builds. → [[Concurrency]]
- **Golden signals** — Google's four key service metrics: latency, traffic, errors and saturation. → [[Metrics]]
- **GPU** — A chip with many cores that runs thousands of calculations at once, which makes it fast for AI math. → [[Cloud & Infrastructure]]
- **GPU cluster** — Many GPU machines linked by a fast network so they can work together on one large training job. → [[Cloud & Infrastructure]]
- **Graceful degradation** — Dropping non-essential features during a failure so the core job keeps working. → [[Fault Tolerance]]
- **Graph** — A set of items (nodes) joined by connections (edges), used to answer questions about what links to what. → [[Data Structures]]
- **Graph database** — A database that stores items as nodes and the connections between them as relationships, suited to networks. → [[NoSQL Databases]]
- **Ground truth** — The real outcome, often known only later, used to check whether a model's prediction was right. → [[AI Monitoring & Observability]]
- **Grounding** — Basing an AI answer on specific retrieved source text rather than on what the model memorized in training. → [[Retrieval-Augmented Generation]]
- **gRPC** — Fast, typed calls between services using compact binary messages.
- **Guardrail** — An automatic check around an AI model that blocks unsafe or off-topic messages and wrong answers. → [[Capstone - AI Support Assistant]]
- **Guardrails & AI Safety** — Checks around a model that keep its inputs and outputs safe.

## H

- **Hallucination** — When a language model produces fluent, confident text that is false. → [[AI Model Types]]
- **Handshake** — The opening web request in which browser and server agree to upgrade the connection to a WebSocket. → [[WebSockets]]
- **Hash function** — A formula that scrambles a key into a number, used to spread data evenly across shards. → [[Sharding]]
- **Hash map** — A structure that turns a key into a storage slot, so looking up a value by its exact key takes about the same time at any size. → [[Data Structures]]
- **Hashing** — Turning data into a fixed one-way fingerprint that cannot be reversed; used to store passwords safely and detect changes. → [[Encryption]]
- **HATEOAS** — A REST principle where responses include links telling the client what it can do next. → [[REST]]
- **Health check** — A small test request sent on a timer to see whether a server works; failing servers stop receiving traffic. → [[Load Balancing]]
- **Heartbeat** — A small periodic message, such as a ping, that keeps a connection alive and checks the other side is still there. → [[WebSockets]]
- **High-Level Design** — The big-picture blueprint: boxes, arrows and why.
- **High-level design (HLD)** — The big-picture plan of a system: its main parts, how they connect, and why each choice was made. → [[High-Level Design]]
- **High-risk AI system** — Under the EU AI Act, AI used in areas like hiring or credit scoring that must meet strict safety and oversight rules. → [[Ethics & Governance]]
- **HNSW** — Hierarchical Navigable Small World: a popular ANN index that links vectors in layered graphs, searched from sparse top layers downward. → [[Embeddings & Vector Databases]]
- **Horizontal partitioning** — Splitting a database's records across several machines; another name for sharding. → [[Sharding]]
- **Horizontal scaling** — Handling more traffic by adding more machines side by side, instead of replacing one machine with a bigger one. → [[Load Balancing]]
- **Hot partition** — One key that receives so much traffic it overloads the server holding it, slowing everything nearby. → [[NoSQL Databases]]
- **Hot spot** — A shard that receives far more traffic than the others, slowing things down. → [[Sharding]]
- **HTTP** — The request-and-response protocol browsers and servers use to exchange web pages and data. → [[Networking]]
- **HTTP 429** — The standard web error "Too Many Requests", telling a caller to slow down and try again later. → [[Rate Limiting]]
- **HTTP method** — The verb of a web request, such as GET to read, POST to create, or DELETE to remove. → [[REST]]
- **HTTP/2** — A newer version of the web's protocol that can carry many requests at once over a single connection. → [[gRPC]]
- **Human in the loop** — A person who must review or approve certain AI actions, usually costly or irreversible ones, before they happen. → [[Guardrails & AI Safety]]
- **Human oversight** — A person who can check, override or stop an AI system's decision. → [[Ethics & Governance]]
- **Hybrid search** — Combining meaning-based vector search with keyword search, then merging both result lists into one ranking. → [[Retrieval-Augmented Generation]]
- **Hyperparameter** — A setting chosen before training, such as the learning rate or how many passes over the data to make. → [[Model Selection & Training]]

## I

- **Idempotency key** — A unique label a client attaches to a request so the server can spot retries and avoid doing the work twice. → [[API Design]]
- **Idempotent** — Safe to repeat: doing it twice has the same effect as doing it once. → [[API Design]]
- **Incident commander** — The one person who leads and coordinates a team's response during an outage. → [[AI Reliability & Fault Tolerance]]
- **Index** — A lookup structure, like a book's index, that lets a database find rows without scanning the whole table. → [[Databases]]
- **Indirect prompt injection** — Prompt injection hidden inside content the AI reads, like a web page, document or email, rather than typed by the user. → [[AI Security & Privacy]]
- **Inference** — Using a trained model to answer a new question or make a prediction. → [[AI System Design Overview]]
- **Inheritance** — Letting a new class start from an existing class, reusing its data and actions and adding its own. → [[Object-Oriented Programming]]
- **Interface** — A promise of what a piece of code can do, without saying how it does it. → [[Low-Level Design]]
- **IP address** — The numeric address that identifies a device on a network so data can be delivered to it. → [[Networking]]

## J

- **Jaeger** — An open-source distributed tracing system first built at Uber and now a CNCF project. → [[Distributed Tracing]]
- **Jailbreak** — A message crafted to trick an AI model into ignoring its safety rules. → [[Guardrails & AI Safety]]
- **Jitter** — Random variation added to retry wait times so many clients don't all retry at the same moment. → [[Fault Tolerance]]
- **Join** — Combining rows from two tables that share a matching key into one result. → [[SQL Databases]]
- **JSON Web Token (JWT)** — A compact, signed text token carrying facts about a user, like their ID and expiry time, that servers can verify without a lookup. → [[Authentication]]

## K

- **Kernel** — The core of an operating system, running with full control of the hardware and handling programs' requests. → [[Operating Systems]]
- **Key-value store** — A database that saves each value under a unique key and fetches it back by that key, very fast. → [[NoSQL Databases]]
- **Knowledge base** — A company's library of help articles and policies that a support assistant searches before answering. → [[Capstone - AI Support Assistant]]
- **KV cache** — Working notes a language model saves for every token so far, kept in GPU memory so it never recomputes them. → [[LLM Inference & Optimization]]

## L

- **Label** — The correct answer attached to a training example, such as spam or not spam, added by people or software. → [[Data Sources]]
- **Large language model (LLM)** — A model trained on huge amounts of text that reads and writes language by predicting the next word or word fragment. → [[AI Model Types]]
- **Latency** — The time a message takes to travel from sender to receiver, often measured as a round trip. → [[Networking]]
- **Latency numbers** — Memorized approximate times for common operations, such as reading memory or crossing an ocean, used to estimate performance. → [[Estimation]]
- **Layer 4 vs layer 7** — Layer 4 balancers route using only network addresses and ports; layer 7 balancers read the request itself, such as its web address. → [[Load Balancing]]
- **Leader-follower replication** — One machine (the leader) accepts every change and passes it to copies (followers); older docs call this master-slave. → [[Replication]]
- **Leaky bucket** — A limiter that lets requests through at a fixed, steady pace, allowing no bursts. → [[Rate Limiting]]
- **Least privilege** — Giving each person or program only the permissions its job truly needs, so a stolen account can do little damage. → [[Authorization]]
- **Linearizability** — The strict meaning of consistency in CAP: every operation appears to happen at one instant, in real-time order. → [[CAP Theorem]]
- **Little's Law** — A rule linking load and delay: items in a system equal arrival rate multiplied by average time each item spends inside. → [[Estimation]]
- **LLM Inference & Optimization** — Making large models answer fast and cheaply.
- **LLM observability** — Recording each chatbot request, model call, tool call, cost and delay so you can explain why an answer went wrong. → [[AI Monitoring & Observability]]
- **LLM-as-a-judge** — Using a strong language model to grade or compare another model's answers instead of a human reviewer. → [[Evaluation & Metrics]]
- **LLMOps** — MLOps practices applied to large language model apps, including versioning prompts and testing them against evaluation sets. → [[MLOps & CI-CD]]
- **Load balancer** — A traffic director that sits in front of a group of servers and spreads incoming requests across them. → [[Load Balancing]]
- **Load Balancing** — Spreading incoming work across many servers so none is overwhelmed.
- **Load shedding** — Deliberately rejecting less important requests when a service is overloaded, to keep critical ones working. → [[Rate Limiting]]
- **Lock (mutex)** — A token only one thread can hold at a time, used so only one thread touches shared data at once. → [[Concurrency]]
- **Log** — A timestamped record of one event that happened inside a program, such as a failed payment. → [[Logging]]
- **Log aggregation** — Collecting logs from many machines into one central place where they can be searched together. → [[Logging]]
- **Log injection** — An attack where crafted input adds fake lines to a log, hiding or forging what really happened. → [[Logging]]
- **Logging** — Writing down what happened, event by event.
- **Long polling** — A technique where the server holds a request open until it has news, then the client immediately asks again. → [[WebSockets]]
- **LoRA** — A cheap fine-tuning method that freezes the original model and trains small add-on pieces instead of every weight. → [[Model Selection & Training]]
- **Low-Level Design** — Zooming into one part: its classes, data and interfaces.
- **Low-level design (LLD)** — A detailed plan for one part of a system: its classes, the data they hold and how they interact. → [[Low-Level Design]]

## M

- **MCP (Model Context Protocol)** — An open standard for connecting AI applications to tools and data sources, often likened to a USB-C port for AI. → [[AI Agents & Tool Use]]
- **Message broker** — The software that runs queues and delivers messages, such as Amazon SQS, RabbitMQ or Apache Kafka. → [[Message Queues]]
- **Message queue** — A buffer that holds tasks sent by one part of a system until another part is ready to process them. → [[Message Queues]]
- **Message Queues** — Buffers that let parts of a system hand off work without waiting.
- **Method** — An action an object can perform, usually reading or changing that object's own data. → [[Object-Oriented Programming]]
- **Metric** — A number about a system, such as requests per second, measured again and again over time. → [[Metrics]]
- **Metrics** — Numbers over time that show a system's health at a glance.
- **Microservice** — A small, independently deployed program that handles one business job and owns its own data. → [[Microservices]]
- **Microservices** — Many small services, each owning one job, talking over the network.
- **ML pipeline** — A scripted, repeatable series of steps, such as fetching data, checking it, training and evaluating, that produces a model. → [[MLOps & CI-CD]]
- **ML technical debt** — Hidden long-term maintenance cost that builds up in AI systems from tangled data, glue code and missing monitoring. → [[AI System Design Overview]]
- **MLOps** — The practices and tools for building, shipping, monitoring and retraining machine learning systems reliably. → [[AI System Design Overview]]
- **MLOps & CI-CD** — Automating how models are built, tested, versioned and shipped.
- **Model** — A program that learned its behavior from example data instead of being written rule by rule. → [[AI System Design Overview]]
- **Model card** — A short document shipped with an AI model describing its intended use, how it was tested and its limits. → [[Ethics & Governance]]
- **Model decay** — A model slowly getting less accurate because the world has drifted away from the data it learned from. → [[AI System Design Overview]]
- **Model distillation** — Training a small student model to imitate a large teacher model, so it keeps much of the skill but costs less to run. → [[Cost Optimization]]
- **Model layer** — The part of an AI system that trains, tests and versions models before they are allowed into production. → [[AI Architecture Layers]]
- **Model monitoring** — Continuously checking a live model's inputs, outputs and results so you notice when its answers quietly get worse. → [[AI Monitoring & Observability]]
- **Model parallelism** — Splitting one model across several GPUs because it is too big for a single chip's memory. → [[AI Scalability & Distributed Systems]]
- **Model registry** — A catalog of trained model versions, how each was made, and which one is currently live. → [[AI Architecture Layers]]
- **Model routing** — Sending each request to a cheaper or stronger AI model depending on how hard the request looks. → [[Cost Optimization]]
- **Model Selection & Training** — Choosing the right model and teaching it from data.
- **Model serving** — Running a model as a service that apps can call for predictions, quickly and reliably. → [[Deployment & Serving]]
- **Modular monolith** — A monolith whose code is split into clearly separated sections, such as orders and billing, with enforced rules about how they interact. → [[Monoliths]]
- **Monitoring layer** — The part of an AI system that watches data and answer quality and triggers fixes or retraining. → [[AI Architecture Layers]]
- **Monolith** — An application whose features all live in one program that is built, shipped and run as a single unit. → [[Monoliths]]
- **Monoliths** — One program that does everything, deployed as a single unit.
- **Multi-agent system** — Several AI agents splitting one task, usually a lead agent handing pieces to helper agents that work in parallel. → [[AI Agents & Tool Use]]
- **Multi-factor authentication (MFA)** — Logging in with two or more different kinds of proof, such as a password plus a tap on your phone. → [[Authentication]]
- **Multi-leader replication** — Several copies accept changes at once and later reconcile any changes that clash. → [[Replication]]

## N

- **Natural language processing (NLP)** — The branch of AI that works with human language, such as translation, summarizing or classifying text. → [[AI Model Types]]
- **Network partition** — A break in the network that splits servers into groups that cannot talk to each other. → [[CAP Theorem]]
- **Networking** — How computers find each other and exchange messages.
- **Non-functional requirement (NFR)** — A quality a system must have, such as speed, reliability or security, rather than a specific feature. Also called a quality attribute. → [[Requirements]]
- **Non-goal** — Something that could reasonably be a goal but that a design deliberately chooses not to do. → [[High-Level Design]]
- **Normalization** — Designing tables so each fact is stored in one place, preventing contradictory copies of the same data. → [[SQL Databases]]
- **NoSQL** — "Not only SQL": databases that skip the classic relational table model for flexible shapes built to spread across many machines. → [[NoSQL Databases]]
- **NoSQL Databases** — Flexible databases built for scale and specific access patterns.

## O

- **OAuth** — A standard that lets an app get limited, revocable access to your data elsewhere without ever learning your password. → [[Authentication]]
- **Object** — A bundle of code holding some data (its state) together with the actions (methods) that work on that data. → [[Object-Oriented Programming]]
- **Object key** — An object's unique name inside its bucket; slashes in it only look like folders. → [[Object Storage]]
- **Object Storage** — Cheap, near-infinite storage for files like images, videos and backups.
- **Object-Oriented Programming** — Organizing code as objects that bundle data with the actions on it.
- **Observer** — A pattern where a publisher keeps a list of subscribers and notifies each one whenever something happens. → [[Design Patterns]]
- **On-premise** — Running machines a company owns in its own building or data center, instead of renting from a cloud provider. → [[Cloud & Infrastructure]]
- **One-hot encoding** — Turning a category, such as a city, into a list of on/off slots with exactly one slot switched on. → [[Feature Engineering]]
- **One-way / two-way door** — Amazon's terms for decisions that are hard to reverse, deserving care, versus easy to reverse, deserving speed. → [[Trade-offs]]
- **Online inference** — Answering each prediction request right away, as it arrives, from an always-on service. → [[Deployment & Serving]]
- **OpenID Connect (OIDC)** — A login standard built on OAuth that tells an app who you are, using a signed ID token from your identity provider. → [[Authentication]]
- **OpenTelemetry** — An open-source, vendor-neutral standard and toolkit for producing traces, metrics and logs. → [[Distributed Tracing]]
- **Operating system** — The software that sits between programs and hardware, sharing the processor, memory and storage among many programs safely. → [[Operating Systems]]
- **Operating Systems** — The layer that shares one computer between many programs.
- **Order of magnitude** — A factor of ten. Estimates aim to get this right, such as thousands versus millions, not exact digits. → [[Estimation]]
- **Origin server** — The website's own server that holds the original files; the CDN fetches from it when it lacks a copy. → [[CDN]]
- **Overfitting** — When a model memorizes its training examples and then does badly on new data it has not seen. → [[Model Selection & Training]]
- **Overloaded error (529)** — An error some AI APIs return when the service is temporarily too busy across all users to handle a request. → [[AI Reliability & Fault Tolerance]]

## P

- **PACELC** — An extension of CAP: during a network partition choose availability or consistency; otherwise choose lower latency or consistency. → [[Trade-offs]]
- **Pagination** — Splitting a long list of results into smaller pages that are fetched one at a time. → [[API Design]]
- **Parallelism** — Actually running several tasks at the same instant, for example on different processor cores. → [[Concurrency]]
- **Partition key** — The field whose hashed value decides which server stores a record, so reads can go straight there. → [[NoSQL Databases]]
- **Passkey** — A password replacement made of two linked digital keys; the secret one stays on your device, so fake websites have nothing to steal. → [[Authentication]]
- **Peak load** — The busiest moment of traffic, which can be many times the daily average and must be planned for. → [[Estimation]]
- **Percentile** — The value below which a given share of measurements fall; p99 latency is slower than 99% of requests. → [[Metrics]]
- **Percentile (p99)** — The value that a given share of measurements fall under; p99 latency is the time 99% of requests beat. → [[Requirements]]
- **pgvector** — An open-source Postgres extension that stores vectors and runs exact or approximate similarity search beside regular data. → [[Embeddings & Vector Databases]]
- **PII** — Personally identifiable information: details like names, phone numbers and email addresses that can identify a specific person. → [[AI Security & Privacy]]
- **Pipeline parallelism** — Giving each GPU a group of a model's layers, like stations on an assembly line. → [[AI Scalability & Distributed Systems]]
- **Point-in-time correctness** — Using each feature's value exactly as it was at the moment of a past event, never a later value. → [[Feature Engineering]]
- **Polling** — Asking a server over and over whether anything has changed. → [[WebSockets]]
- **Polymorphism** — Different kinds of objects answering the same request, such as "draw yourself", each in their own way. → [[Object-Oriented Programming]]
- **Precision** — Of all the items a model flagged as positive, the share that really were positive. → [[Evaluation & Metrics]]
- **Precision and recall** — Precision is how many flagged items are truly correct; recall is how many true items get found. Raising one usually lowers the other. → [[Business Goals & Requirements]]
- **Prefill and decode** — The two phases of answering: prefill reads the whole prompt at once; decode writes the answer one token at a time. → [[LLM Inference & Optimization]]
- **Presigned URL** — A time-limited link that lets someone download or upload one specific object without having their own cloud credentials. → [[Object Storage]]
- **Primary key** — A column whose value uniquely identifies each row in a table, like a customer number. → [[SQL Databases]]
- **Process** — One running copy of a program, with its own private memory and state, managed by the operating system. → [[Operating Systems]]
- **Producer** — The part of a system that creates messages and puts them into a queue. → [[Message Queues]]
- **Product quantization** — A compression method that splits vectors into pieces and stores short codes, letting billions of vectors fit in memory. → [[Embeddings & Vector Databases]]
- **Prometheus** — A popular open-source system that pulls metrics from services, stores them and triggers alerts. → [[Metrics]]
- **Prompt caching** — Having the provider reuse a long, repeated part of a prompt so later requests pay much less for it and answer faster. → [[Cost Optimization]]
- **Prompt injection** — An attack where text from a user or a document tricks an AI into ignoring its instructions. → [[Capstone - AI Support Assistant]]
- **.proto file** — A plain text contract listing a service's methods and the shape of each message, used to generate code. → [[gRPC]]
- **Protocol** — An agreed set of rules for how computers format, send and respond to messages. → [[Networking]]
- **Protocol Buffers (protobuf)** — Google's compact binary format for structured data, described in a contract file; like JSON but smaller and faster. → [[gRPC]]
- **Provisioned concurrency** — Paying to keep a set number of function environments ready in advance so requests avoid cold starts. → [[Serverless]]
- **Proxy discrimination** — When a model infers a protected trait like gender from other data, such as words or schools, and treats people unfairly. → [[Ethics & Governance]]
- **Proxy metric** — A measurable stand-in for something you can't measure directly, like predicting likes as a stand-in for usefulness. → [[Business Goals & Requirements]]
- **Pub/sub** — Publish/subscribe: a messaging pattern where one published message is delivered to every subscriber that wants it. → [[Message Queues]]
- **Public-key cryptography** — Encryption using a matched key pair: a public key anyone can use to lock, and a private key only its owner uses to unlock. → [[Encryption]]
- **Purge (cache invalidation)** — Telling a CDN to throw away a stored copy before it expires, so the next request fetches a fresh one. → [[CDN]]
- **Push** — A server sending data to a client without the client asking for it first. → [[WebSockets]]

## Q

- **QPS (queries per second)** — How many requests a system receives or handles each second; the standard way to express load. → [[Estimation]]
- **Quantization** — Storing a model's numbers with fewer bits so it needs less memory and fewer or cheaper chips. → [[Cost Optimization]]
- **Query** — A question or instruction sent to a database, usually written in SQL, to read or change data. → [[Databases]]
- **Quorum** — The minimum number of copies that must respond for a read or write to count. → [[Replication]]
- **Quota** — A usage allowance over a longer period, such as requests per day or per month. → [[Rate Limiting]]

## R

- **Race condition** — A bug where the result depends on which task happens to run first, so it fails only sometimes. → [[Concurrency]]
- **Rate limit** — The maximum number of requests a caller may make to a service in a given period of time. → [[Rate Limiting]]
- **Rate Limiting** — Capping how often someone can call you, to stay fair and safe.
- **Read-heavy** — Describes a system that answers far more lookups than it stores new data. → [[Case Studies]]
- **Rebalancing** — Moving data between shards to even out storage and traffic as the system grows. → [[Sharding]]
- **Recall** — Of all the truly positive items, the share the model managed to catch. → [[Evaluation & Metrics]]
- **Reciprocal Rank Fusion (RRF)** — A way to merge ranked lists by summing 1/(rank + k) for each item, rewarding items ranked high in several lists. → [[Retrieval-Augmented Generation]]
- **Recommender system** — A model that suggests items a person is likely to want next, such as videos, songs or products. → [[AI Model Types]]
- **Red teaming** — Deliberately attacking your own AI system, the way a real attacker would, to find weaknesses before they are exploited. → [[AI Security & Privacy]]
- **Redundancy** — Keeping spare copies of servers or data ready to take over when one breaks. → [[Fault Tolerance]]
- **Relational database** — A database that stores data in tables of rows and columns and links tables together through shared keys. → [[SQL Databases]]
- **Relationship-based access control (ReBAC)** — Access that follows links between people and things, such as owning a document or belonging to a shared folder's group. → [[Authorization]]
- **Replica** — A full copy of a database kept on another machine. → [[Replication]]
- **Replication** — Keeping copies of data on several machines so one can fail.
- **Replication lag** — How far a follower copy trails behind the leader, during which it may show old data. → [[Replication]]
- **Requirements** — Pinning down what the system must do and how well, before building.
- **Reranking** — A slower, more accurate second pass, often a cross-encoder model, that rescores top search results against the question. → [[Retrieval-Augmented Generation]]
- **Resource** — Any named piece of information in a REST API, such as a customer or an order. → [[REST]]
- **REST** — The web's most common API style: resources over plain HTTP.
- **Retrieval-Augmented Generation** — Letting a model look things up before it answers.
- **Retrieval-augmented generation (RAG)** — A method where the AI first looks up relevant documents, then writes its answer based on what it found. → [[Capstone - AI Support Assistant]]
- **Reverse proxy** — A server that receives requests on behalf of other servers and forwards them; many load balancers work this way. → [[Load Balancing]]
- **Role-based access control (RBAC)** — Giving people roles like editor or admin, where each role comes with a fixed set of permissions. → [[Authorization]]
- **Rollback** — Switching back to the previous model or software version quickly when a new release causes problems. → [[MLOps & CI-CD]]
- **Round robin** — The simplest way to share work: each new request goes to the next server in turn, then back to the first. → [[Load Balancing]]
- **RPC (remote procedure call)** — Calling a function that runs on another machine as if it were part of your own program. → [[gRPC]]

## S

- **Saga** — A sequence of small, separate database updates across services, with undo steps if a later step fails. → [[Microservices]]
- **Sampling** — Keeping only some traces, such as one in a hundred, to control storage and processing cost. → [[Distributed Tracing]]
- **Scale cube** — A model of three ways to scale software: copy the whole app, split it by function, or split the data. → [[Monoliths]]
- **Schema** — The plan for a database's data: which tables exist, which columns they have and what each column may hold. → [[Databases]]
- **Scope** — The agreed boundary of what will and will not be built in a given project or design. → [[Requirements]]
- **Semantic search** — Finding results by meaning rather than by matching exact words, usually by comparing embeddings. → [[Embeddings & Vector Databases]]
- **Server-sent events (SSE)** — A one-way stream of updates from a server to a browser over a long-lived HTTP response, with automatic reconnection. → [[WebSockets]]
- **Serverless** — Running code without managing servers; you pay per use.
- **Service mesh** — A layer of helper proxies placed beside each service to handle encryption, retries, routing and monitoring outside the application code. → [[Microservices]]
- **Service-oriented architecture (SOA)** — An older, company-wide style for connecting business applications as reusable services, often through a central integration hub. → [[Microservices]]
- **Serving layer** — The part of an AI system that runs the model to answer requests from apps and users. → [[AI Architecture Layers]]
- **Session token** — A long random string your browser shows after login, acting like a key card so you don't re-enter your password. → [[Authentication]]
- **Severity level** — A label saying how serious a log event is, such as DEBUG, INFO, WARN or ERROR. → [[Logging]]
- **Shadow deployment** — Sending copies of real requests to a new model while users only see the old model's answers. → [[Deployment & Serving]]
- **Shard** — One piece of a large dataset, stored on its own machine. → [[Sharding]]
- **Shard key** — The field, such as a customer ID, that decides which shard each record lives on. → [[Sharding]]
- **Sharding** — Splitting data across machines so no one machine holds it all.
- **Silent quality regression** — When an AI model keeps answering normally but its answers quietly get worse, without any visible errors. → [[AI Reliability & Fault Tolerance]]
- **Single sign-on (SSO)** — Logging in once with a trusted provider, like Google or your employer, which then vouches for you to many other apps. → [[Authentication]]
- **Singleton** — A pattern that allows a class only one instance and makes it reachable from anywhere; often criticized for hurting testability. → [[Design Patterns]]
- **SLA (service level agreement)** — A promise to customers about service levels that carries a consequence, such as a refund or credit, when it is broken. → [[Requirements]]
- **SLI (service level indicator)** — A measurement of how well a service is doing, such as the share of requests that succeed or finish quickly. → [[Requirements]]
- **Sliding window** — A way of counting requests over the last fixed stretch of time from right now, avoiding bursts at window edges. → [[Rate Limiting]]
- **SLO (service level objective)** — A target value for an SLI, such as 99.9% of requests succeeding over a month. → [[Requirements]]
- **Snowflake ID** — A 64-bit unique ID made from a timestamp, a machine number and a counter, so IDs sort roughly by creation time. → [[Case Studies]]
- **SOLID** — Five rules of thumb for designing classes: single responsibility, open-closed, Liskov substitution, interface segregation and dependency inversion. → [[Object-Oriented Programming]]
- **Span** — One timed step of work inside a trace, such as a single database call. → [[Distributed Tracing]]
- **Speculative decoding** — A small fast model drafts the next few tokens and the big model checks them all at once, keeping identical output. → [[LLM Inference & Optimization]]
- **Spot instance** — Spare cloud capacity rented at a discount that the provider can take back with a two-minute warning. → [[Cloud & Infrastructure]]
- **SQL** — Structured Query Language, the standard language for adding, changing, deleting and finding data in relational databases. → [[SQL Databases]]
- **SQL Databases** — Tables with strict structure, joined and queried with SQL.
- **Stakeholder** — Anyone affected by or responsible for a system: users, sponsors, support staff, or people the system decides about. → [[Business Goals & Requirements]]
- **Stale read** — An answer based on an out-of-date copy of the data. → [[CAP Theorem]]
- **State machine** — A fixed list of states something can be in, plus the rules for which moves between states are allowed. → [[Low-Level Design]]
- **Stateless** — The server keeps no memory of a client between requests; each request carries everything needed to answer it. → [[REST]]
- **Static content** — Files that are the same for every user, such as images, videos, style sheets and scripts, which CDNs cache well. → [[CDN]]
- **Status code** — A three-digit number in every HTTP response saying how the request went, like 200 OK or 404 Not Found. → [[REST]]
- **Sticky session** — Keeping one user's requests on the same server for a whole visit, usually by means of a cookie. → [[Load Balancing]]
- **Storage class** — A price-and-speed tier for stored objects, from frequently accessed to cheap deep archive that takes hours to retrieve. → [[Object Storage]]
- **Strangler Fig pattern** — Replacing an old system gradually by building new parts beside it and moving features over one at a time. → [[Monoliths]]
- **Strategy** — A pattern that puts interchangeable ways of doing one task behind a common interface, swappable while the program runs. → [[Design Patterns]]
- **Stream processing** — Handling each piece of data the moment it arrives, instead of waiting to collect a big pile. → [[Data Engineering & Pipelines]]
- **Streaming RPC** — A gRPC call where the client, the server, or both send a sequence of messages instead of just one. → [[gRPC]]
- **Structured log** — A log written as labeled fields, often JSON, so tools can search, filter and count by each field. → [[Logging]]
- **Stub** — Generated client code that makes a remote call look like a local function call. → [[gRPC]]
- **Success metric** — A number that shows whether the business goal is being met, separate from the model's own accuracy scores. → [[Business Goals & Requirements]]
- **Synchronous replication** — The leader waits for a copy to confirm each change before saying saved: safer, but slower. → [[Replication]]
- **System call** — A program's formal request to the kernel for something it cannot do itself, such as reading a file or sending data. → [[Operating Systems]]
- **System prompt** — Standing instructions sent with every request that set the model's role, tone and rules. → [[Context Engineering]]

## T

- **TCP** — A transport protocol that delivers data reliably and in order, re-sending anything lost, after a short setup handshake. → [[Networking]]
- **Test set** — Examples kept aside and never used in training, so they can fairly measure how the model will do in reality. → [[Model Selection & Training]]
- **Thread** — An independent line of work inside a program; several threads can run side by side and share the program's memory. → [[Concurrency]]
- **Throttling** — Slowing down or rejecting a caller's requests once they reach their limit. → [[Rate Limiting]]
- **Throughput** — How much total work a system completes per unit of time, such as requests handled per second. → [[Trade-offs]]
- **Time series** — A run of timestamped values for one measurement, which can be drawn as a line on a chart. → [[Metrics]]
- **Time to first token** — How long a user waits before the first word of an AI answer appears. → [[LLM Inference & Optimization]]
- **Timeout** — The longest a program will wait for an answer from another service before giving up. → [[Fault Tolerance]]
- **TLS / HTTPS** — TLS is the protocol that encrypts and verifies internet connections; HTTPS is ordinary web browsing carried over TLS. → [[Encryption]]
- **Token** — A small chunk of text, roughly a short word, that AI providers count and charge for. → [[Cost Optimization]]
- **Token bucket** — A limiter where each request spends a token and tokens refill steadily, allowing short bursts but capping the average rate. → [[Rate Limiting]]
- **Tool use** — Letting an AI assistant call company systems, such as an order database, to look up or change real records. → [[Capstone - AI Support Assistant]]
- **Tool use (function calling)** — A model replying with a structured request to run a named action, which the application then executes and reports back. → [[AI Agents & Tool Use]]
- **TPU** — Google's custom chip designed specifically to speed up machine learning, rented through Google Cloud. → [[Cloud & Infrastructure]]
- **Trace** — The full record of one request's path through all the services it touched. → [[Distributed Tracing]]
- **Trace ID** — The unique label shared by every span in one trace, used to stitch them together. → [[Distributed Tracing]]
- **Trade-off** — A design decision where gaining one quality, such as speed, means giving up some of another, such as cost or freshness. → [[Trade-offs]]
- **Trade-offs** — Every design choice gives something up; good design picks knowingly.
- **Training** — Showing a model many examples so it learns patterns it can use on new cases. → [[AI System Design Overview]]
- **Training-serving skew** — When a feature is computed differently during training than when serving live, so the model sees unfamiliar numbers. → [[AI Architecture Layers]]
- **Transaction** — A group of database changes that all succeed together or all fail together, with no half-finished state visible. → [[Databases]]
- **Transfer learning** — Reusing what a model learned on one problem to solve a similar problem with less data. → [[Model Selection & Training]]
- **Transformer** — The model design behind modern LLMs, which uses attention to weigh how every word relates to every other word. → [[AI Model Types]]
- **Tree** — Data kept in sorted, branching order, so each step of a search skips large parts of the rest. → [[Data Structures]]
- **Two-pizza team** — Amazon's term for a team small enough that two pizzas could feed it, owning one service end to end. → [[Microservices]]

## U

- **UDP** — A lightweight transport protocol that sends individual messages with no setup and no guarantee they arrive. → [[Networking]]
- **UML** — Unified Modeling Language: a standard set of diagram types for describing software designs. → [[Low-Level Design]]
- **URI** — The unique web address that identifies a resource, like /orders/1. → [[REST]]
- **URL shortener** — A service that turns a long web address into a short code and redirects visitors from the code to the original. → [[Case Studies]]

## V

- **Vector database** — A database built to store embeddings and quickly find the stored items whose vectors are closest to a query. → [[Embeddings & Vector Databases]]
- **Vendor lock-in** — Being tied to one cloud provider because your code depends on its services and moving would be costly. → [[Serverless]]
- **Vertical scaling** — Handling more load by buying a bigger machine instead of adding more machines. → [[Sharding]]
- **Virtual memory** — The technique that gives each process its own private view of memory, which the OS maps onto real memory chips. → [[Operating Systems]]
- **Visibility timeout** — How long a received message stays hidden from other consumers before it reappears if not deleted. → [[Message Queues]]

## W

- **Warm start** — When a function runs in an environment kept from an earlier request, so it starts faster. → [[Serverless]]
- **Watermark** — A stream processor's estimate of when all events for a time window have arrived, so it can publish results. → [[Data Engineering & Pipelines]]
- **WebSocket** — A lasting, two-way connection between a browser and a server that lets either side send messages at any time. → [[WebSockets]]
- **WebSockets** — A connection that stays open so the server can push updates instantly.
- **Wide-column database** — A database, like Cassandra, that groups rows under a partition key and spreads those groups across many servers. → [[NoSQL Databases]]
- **Workflow vs. agent** — A workflow follows steps a developer fixed in advance; an agent lets the model choose its own steps and tools. → [[AI Agents & Tool Use]]
- **Write-ahead log** — A log where a database records each change before applying it, so it can recover committed work after a crash. → [[Databases]]
