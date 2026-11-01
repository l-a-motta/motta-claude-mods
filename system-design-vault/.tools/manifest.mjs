// The single source of truth for the vault's notes: every filename, folder, alias and one-line summary.
// Writers may only link to titles listed here (plus the fixed notes in FIXED_NOTES).
// A topic is [title, aliases, summary]. Each topic has two notes: `<title>.md` and `<title> (Deep Dive).md`.

export const FIXED_NOTES = ['00 Start Here', 'Glossary', 'Sources Index', 'How to Use This Vault'];

export const PARTS = [
  {
    title: 'Part 1 System Design',
    label: 'Part 1 · System Design',
    icon: '🏗️',
    blurb: 'The handle of the umbrella: how any large software system is designed, AI or not.',
    sections: [
      {
        title: 'Foundations', folder: '1 Foundations', icon: '📖', color: '#4F86F7',
        blurb: 'The building blocks every system stands on: code, computers, networks and how to think about a design.',
        branches: [
          {
            title: 'Programming', icon: '💻',
            blurb: 'How software is organized and how it does many things at once.',
            topics: [
              ['Object-Oriented Programming', ['OOP', 'objects', 'classes', 'inheritance', 'encapsulation', 'SOLID'], 'Organizing code as objects that bundle data with the actions on it.'],
              ['Design Patterns', ['patterns', 'gang of four', 'GoF', 'singleton', 'factory', 'observer'], 'Named, reusable solutions to problems that keep coming up in code.'],
              ['Concurrency', ['threads', 'parallelism', 'async', 'race condition', 'deadlock', 'locks'], 'Doing many things at once without the pieces tripping over each other.'],
            ],
          },
          {
            title: 'Core Concepts', icon: '🧠',
            blurb: 'What every engineer knows about how computers store, run and move information.',
            topics: [
              ['Data Structures', ['arrays', 'hash map', 'hash table', 'trees', 'graphs', 'Big O', 'algorithms'], 'Ways of arranging data so the right questions are fast to answer.'],
              ['Operating Systems', ['OS', 'processes', 'memory', 'kernel', 'Linux', 'file system'], 'The layer that shares one computer between many programs.'],
              ['Networking', ['TCP', 'UDP', 'IP', 'DNS', 'HTTP', 'latency', 'bandwidth', 'OSI model'], 'How computers find each other and exchange messages.'],
              ['Databases', ['DB', 'database', 'data modeling', 'indexes', 'transactions', 'ACID', 'schema'], 'Systems that store data safely and let you query it later.'],
            ],
          },
          {
            title: 'Design Basics', icon: '💡',
            blurb: 'The habits of mind of a system designer: ask, estimate, choose.',
            topics: [
              ['Requirements', ['functional requirements', 'non-functional requirements', 'NFR', 'SLA', 'SLO', 'scope'], 'Pinning down what the system must do and how well, before building.'],
              ['Estimation', ['back-of-the-envelope', 'capacity planning', 'QPS', 'napkin math', 'latency numbers'], 'Quick math that tells you how big the problem really is.'],
              ['Trade-offs', ['tradeoffs', 'system thinking', 'consistency vs availability', 'latency vs throughput'], 'Every design choice gives something up; good design picks knowingly.'],
            ],
          },
        ],
      },
      {
        title: 'Architecture', folder: '2 Architecture', icon: '🏛️', color: '#9B59B6',
        blurb: 'How a system is cut into parts, where its data lives, and how many machines share the work.',
        branches: [
          {
            title: 'Architecture Styles', icon: '🧱',
            blurb: 'The big shapes a system can take, from one program to many tiny functions.',
            topics: [
              ['Monoliths', ['monolith', 'monolithic architecture', 'modular monolith'], 'One program that does everything, deployed as a single unit.'],
              ['Microservices', ['microservice', 'service-oriented architecture', 'SOA', 'service mesh'], 'Many small services, each owning one job, talking over the network.'],
              ['Serverless', ['FaaS', 'functions as a service', 'AWS Lambda', 'cloud functions'], 'Running code without managing servers; you pay per use.'],
            ],
          },
          {
            title: 'Data & Storage', icon: '🗄️',
            blurb: 'The main families of storage and what each is good at.',
            topics: [
              ['SQL Databases', ['SQL', 'relational database', 'RDBMS', 'PostgreSQL', 'MySQL', 'joins', 'normalization'], 'Tables with strict structure, joined and queried with SQL.'],
              ['NoSQL Databases', ['NoSQL', 'document database', 'key-value store', 'wide-column', 'graph database', 'MongoDB', 'Cassandra', 'DynamoDB'], 'Flexible databases built for scale and specific access patterns.'],
              ['Object Storage', ['blob storage', 'S3', 'buckets', 'data lake'], 'Cheap, near-infinite storage for files like images, videos and backups.'],
            ],
          },
          {
            title: 'Distributed Systems', icon: '🕸️',
            blurb: 'What changes when one computer is not enough and many must act as one.',
            topics: [
              ['CAP Theorem', ['CAP', 'PACELC', 'consistency', 'availability', 'partition tolerance', 'eventual consistency'], 'When the network breaks, a system must choose: stay correct or stay up.'],
              ['Replication', ['replicas', 'leader-follower', 'master-slave', 'multi-leader', 'quorum', 'failover'], 'Keeping copies of data on several machines so one can fail.'],
              ['Sharding', ['partitioning', 'horizontal partitioning', 'consistent hashing', 'shard key'], 'Splitting data across machines so no one machine holds it all.'],
            ],
          },
        ],
      },
      {
        title: 'Scalability', folder: '3 Scalability', icon: '📈', color: '#27AE60',
        blurb: 'How systems talk, stay fast, and keep working as traffic grows.',
        branches: [
          {
            title: 'Communication', icon: '💬',
            blurb: 'How the parts of a system, and its users, talk to each other.',
            topics: [
              ['API Design', ['API', 'application programming interface', 'endpoints', 'versioning', 'pagination', 'idempotency'], 'Designing the contract other programs use to talk to yours.'],
              ['REST', ['RESTful', 'HTTP API', 'JSON API', 'resources', 'CRUD'], 'The web\'s most common API style: resources over plain HTTP.'],
              ['gRPC', ['RPC', 'remote procedure call', 'protocol buffers', 'protobuf', 'HTTP/2'], 'Fast, typed calls between services using compact binary messages.'],
              ['WebSockets', ['WebSocket', 'real-time', 'push', 'server-sent events', 'SSE', 'long polling'], 'A connection that stays open so the server can push updates instantly.'],
            ],
          },
          {
            title: 'Performance', icon: '⚡',
            blurb: 'Making systems fast by doing less work and doing it closer to the user.',
            topics: [
              ['Caching', ['cache', 'caches', 'Redis', 'Memcached', 'cache invalidation', 'TTL', 'cache hit'], 'Keeping a copy of frequently used data somewhere faster.'],
              ['CDN', ['content delivery network', 'edge', 'edge caching', 'Cloudflare', 'CloudFront'], 'Servers around the world that hand out content close to each user.'],
              ['Load Balancing', ['load balancer', 'LB', 'round robin', 'reverse proxy', 'NGINX', 'horizontal scaling'], 'Spreading incoming work across many servers so none is overwhelmed.'],
            ],
          },
          {
            title: 'Reliability', icon: '🛡️',
            blurb: 'Keeping the system working when parts of it fail or traffic spikes.',
            topics: [
              ['Message Queues', ['queues', 'queue', 'message broker', 'Kafka', 'RabbitMQ', 'SQS', 'pub/sub', 'event streaming'], 'Buffers that let parts of a system hand off work without waiting.'],
              ['Fault Tolerance', ['resilience', 'redundancy', 'retries', 'circuit breaker', 'graceful degradation', 'high availability'], 'Designing so that when something breaks, the system keeps going.'],
              ['Rate Limiting', ['throttling', 'rate limiter', 'token bucket', 'leaky bucket', 'quotas'], 'Capping how often someone can call you, to stay fair and safe.'],
            ],
          },
        ],
      },
      {
        title: 'Production', folder: '4 Production', icon: '🚀', color: '#E67E22',
        blurb: 'Running a system for real: keeping it secure, seeing inside it, and designing it on paper.',
        branches: [
          {
            title: 'Security', icon: '🔒',
            blurb: 'Who are you, what may you do, and is the data safe on the way.',
            topics: [
              ['Authentication', ['AuthN', 'login', 'OAuth', 'OpenID Connect', 'OIDC', 'JWT', 'SSO', 'MFA', 'passwords'], 'Proving who someone is.'],
              ['Authorization', ['AuthZ', 'permissions', 'RBAC', 'ABAC', 'access control', 'least privilege'], 'Deciding what someone is allowed to do.'],
              ['Encryption', ['TLS', 'HTTPS', 'encryption at rest', 'encryption in transit', 'hashing', 'public key', 'AES'], 'Scrambling data so only the right people can read it.'],
            ],
          },
          {
            title: 'Observability', icon: '🔭',
            blurb: 'Seeing what a running system is doing, and why.',
            topics: [
              ['Logging', ['logs', 'structured logging', 'log aggregation', 'ELK'], 'Writing down what happened, event by event.'],
              ['Metrics', ['monitoring', 'dashboards', 'Prometheus', 'golden signals', 'RED method', 'USE method', 'alerting'], 'Numbers over time that show a system\'s health at a glance.'],
              ['Distributed Tracing', ['tracing', 'traces', 'spans', 'OpenTelemetry', 'Jaeger'], 'Following one request as it hops across many services.'],
            ],
          },
          {
            title: 'Projects', icon: '📁',
            blurb: 'Putting it all together: from a whiteboard sketch to real designs.',
            topics: [
              ['High-Level Design', ['HLD', 'system architecture diagram', 'system design interview', 'design doc'], 'The big-picture blueprint: boxes, arrows and why.'],
              ['Low-Level Design', ['LLD', 'class diagram', 'object design', 'detailed design'], 'Zooming into one part: its classes, data and interfaces.'],
              ['Case Studies', ['case study', 'URL shortener', 'chat system', 'news feed', 'design examples'], 'Classic systems designed step by step, applying everything above.'],
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Part 2 AI System Design',
    label: 'Part 2 · AI System Design',
    icon: '☂️',
    blurb: 'The canopy of the umbrella: what it takes to design, ship and run systems built around AI models.',
    sections: [
      {
        title: 'AI Foundations', folder: '5 AI Foundations', icon: '🎯', color: '#1F4FD8',
        blurb: 'The whole umbrella at a glance, the business goals underneath it, and the four layers of every AI system.',
        topics: [
          ['AI System Design Overview', ['AI system design', 'ML system design', 'machine learning system design', 'AI umbrella', 'Users & Applications'], 'What makes designing an AI system different from any other system.'],
          ['Business Goals & Requirements', ['use cases', 'constraints', 'success metrics', 'stakeholders', 'business requirements', 'AI product requirements'], 'Starting from the problem and the people, not from the model.'],
          ['AI Architecture Layers', ['data layer', 'model layer', 'serving layer', 'monitoring layer', 'ML architecture'], 'The four layers every AI system has: data, model, serving, monitoring.'],
        ],
      },
      {
        title: 'AI Building Blocks', folder: '6 AI Building Blocks', icon: '🧩', color: '#C0392B',
        blurb: 'The raw ingredients: the data that feeds AI, the kinds of models, and where they run.',
        topics: [
          ['Data Sources', ['data sources', 'streaming data', 'IoT data', 'training data', 'datasets', 'data collection'], 'Where an AI system\'s data comes from: databases, APIs, streams, files, devices.'],
          ['AI Model Types', ['LLM', 'large language model', 'computer vision', 'CV', 'NLP', 'recommendation systems', 'recommender', 'forecasting', 'AI Models'], 'The main families of models and what each is good for.'],
          ['Cloud & Infrastructure', ['cloud platform', 'AWS', 'GCP', 'Azure', 'on-premise', 'GPU', 'TPU', 'compute', 'Infrastructure'], 'The machines, chips and cloud services AI runs on.'],
        ],
      },
      {
        title: 'The 12 Ribs', folder: '7 The 12 Ribs', icon: '☂️', color: '#2E86DE',
        blurb: 'The twelve concerns that together hold up any AI system, numbered as on the umbrella.',
        topics: [
          ['Data Engineering & Pipelines', ['data pipelines', 'ETL', 'ELT', 'data ingestion', 'batch processing', 'stream processing', 'Data Processing'], 'Moving and cleaning data so models get a steady, trustworthy supply.'],
          ['Model Selection & Training', ['model training', 'fine-tuning', 'transfer learning', 'hyperparameters', 'Experimentation', 'experiment tracking', 'prototyping'], 'Choosing the right model and teaching it from data.'],
          ['Feature Engineering', ['features', 'feature store', 'feature selection', 'training-serving skew'], 'Turning raw data into the signals a model can learn from.'],
          ['Evaluation & Metrics', ['model evaluation', 'evals', 'accuracy', 'precision', 'recall', 'F1', 'A/B testing', 'LLM evaluation', 'LLM-as-a-judge'], 'Measuring whether a model is actually good, before and after launch.'],
          ['Deployment & Serving', ['model serving', 'inference', 'model deployment', 'online inference', 'batch inference', 'canary', 'shadow deployment'], 'Putting a trained model where users and apps can call it.'],
          ['AI Scalability & Distributed Systems', ['distributed training', 'data parallelism', 'model parallelism', 'GPU cluster', 'autoscaling'], 'Spreading AI training and serving across many machines and chips.'],
          ['AI Monitoring & Observability', ['model monitoring', 'drift detection', 'data drift', 'concept drift', 'Analytics & Insights', 'LLM observability'], 'Watching a live model for quality drops, drift and surprises.'],
          ['MLOps & CI-CD', ['MLOps', 'CI/CD', 'model registry', 'continuous training', 'ML pipelines', 'LLMOps'], 'Automating how models are built, tested, versioned and shipped.'],
          ['AI Security & Privacy', ['prompt injection', 'data poisoning', 'model security', 'PII', 'differential privacy', 'adversarial attacks'], 'Protecting models, data and users from attacks and leaks.'],
          ['Cost Optimization', ['AI costs', 'GPU costs', 'token costs', 'FinOps', 'model distillation', 'spot instances'], 'Getting the same results for less money.'],
          ['AI Reliability & Fault Tolerance', ['fallbacks', 'model fallback', 'AI reliability', 'Operations', 'incident response'], 'Keeping AI features working when models, GPUs or providers fail.'],
          ['Ethics & Governance', ['responsible AI', 'AI ethics', 'bias', 'fairness', 'explainability', 'Compliance', 'EU AI Act', 'AI regulation', 'model cards'], 'Making AI fair, explainable, lawful and accountable.'],
        ],
      },
      {
        title: 'Modern LLM Systems', folder: '8 Modern LLM Systems', icon: '🤖', color: '#8E44AD',
        blurb: 'The patterns behind today\'s chatbots, copilots and agents built on large language models.',
        topics: [
          ['Context Engineering', ['prompt engineering', 'prompts', 'system prompt', 'context window', 'few-shot', 'prompt caching'], 'Deciding exactly what goes into a model\'s input so it answers well.'],
          ['Embeddings & Vector Databases', ['embeddings', 'vector database', 'vector search', 'semantic search', 'ANN', 'HNSW', 'pgvector'], 'Turning meaning into numbers so you can search by similarity.'],
          ['Retrieval-Augmented Generation', ['RAG', 'retrieval', 'grounding', 'chunking', 'reranking', 'hybrid search'], 'Letting a model look things up before it answers.'],
          ['LLM Inference & Optimization', ['LLM inference', 'KV cache', 'quantization', 'batching', 'continuous batching', 'speculative decoding', 'vLLM', 'tokens per second'], 'Making large models answer fast and cheaply.'],
          ['AI Agents & Tool Use', ['agents', 'AI agent', 'tool use', 'function calling', 'MCP', 'Model Context Protocol', 'multi-agent', 'agentic'], 'Models that plan, call tools and take steps toward a goal.'],
          ['Guardrails & AI Safety', ['guardrails', 'AI safety', 'content moderation', 'hallucination', 'jailbreak', 'human in the loop'], 'Checks around a model that keep its inputs and outputs safe.'],
        ],
      },
      {
        title: 'Capstone', folder: '9 Capstone', icon: '🎓', color: '#16A085',
        blurb: 'One AI system designed from start to finish, using every part of the vault.',
        topics: [
          ['Capstone - AI Support Assistant', ['capstone', 'AI customer support', 'support chatbot design', 'AI case study', 'end-to-end design'], 'Designing an AI customer-support assistant end to end, step by step.'],
        ],
      },
    ],
  },
];

// The rib number on the umbrella, so maps and hubs keep the image's order.
export const RIB_NUMBERS = Object.fromEntries(PARTS[1].sections[2].topics.map((t, i) => [t[0], i + 1]));

// For each AI topic, the Part 1 topics it builds on (the umbrella's handle). Writers link these in "Builds on".
export const BUILDS_ON = {
  'AI System Design Overview': ['Requirements', 'Trade-offs', 'High-Level Design'],
  'Business Goals & Requirements': ['Requirements', 'Estimation', 'Trade-offs'],
  'AI Architecture Layers': ['High-Level Design', 'Microservices', 'Message Queues'],
  'Data Sources': ['Databases', 'API Design', 'Message Queues', 'Object Storage'],
  'AI Model Types': ['Data Structures', 'Trade-offs'],
  'Cloud & Infrastructure': ['Serverless', 'Operating Systems', 'Networking', 'Object Storage'],
  'Data Engineering & Pipelines': ['Message Queues', 'Object Storage', 'SQL Databases', 'NoSQL Databases'],
  'Model Selection & Training': ['Trade-offs', 'Estimation', 'Concurrency'],
  'Feature Engineering': ['Data Structures', 'Databases', 'Caching'],
  'Evaluation & Metrics': ['Metrics', 'Requirements'],
  'Deployment & Serving': ['API Design', 'Load Balancing', 'Microservices', 'Serverless'],
  'AI Scalability & Distributed Systems': ['Sharding', 'Replication', 'Load Balancing', 'Concurrency'],
  'AI Monitoring & Observability': ['Logging', 'Metrics', 'Distributed Tracing'],
  'MLOps & CI-CD': ['Microservices', 'Fault Tolerance'],
  'AI Security & Privacy': ['Authentication', 'Authorization', 'Encryption', 'Rate Limiting'],
  'Cost Optimization': ['Caching', 'Estimation', 'Serverless'],
  'AI Reliability & Fault Tolerance': ['Fault Tolerance', 'Rate Limiting', 'Message Queues', 'Replication'],
  'Ethics & Governance': ['Logging', 'Authorization', 'Requirements'],
  'Context Engineering': ['API Design', 'Caching'],
  'Embeddings & Vector Databases': ['Data Structures', 'Databases', 'NoSQL Databases', 'Sharding'],
  'Retrieval-Augmented Generation': ['Databases', 'Caching', 'API Design'],
  'LLM Inference & Optimization': ['Caching', 'Concurrency', 'Load Balancing', 'Estimation'],
  'AI Agents & Tool Use': ['API Design', 'Authorization', 'Fault Tolerance', 'Message Queues'],
  'Guardrails & AI Safety': ['Rate Limiting', 'Authorization', 'Logging'],
  'Capstone - AI Support Assistant': ['High-Level Design', 'Case Studies', 'Requirements'],
};

// Learning paths ("classes"). `deep: true` sends the reader to the deep dives.
export const PATHS = [
  {
    title: 'Path 1 - The Big Picture', icon: '🌱', who: 'Anyone, no tech background needed.', time: '≈ 2–3 hours', deep: false,
    goal: 'Understand how big apps and AI products are built, well enough to follow a conversation with engineers.',
    lessons: [
      'Requirements', 'Trade-offs', 'Networking', 'Databases', 'Monoliths', 'Microservices',
      'SQL Databases', 'NoSQL Databases', 'Caching', 'CDN', 'Load Balancing', 'Message Queues',
      'Fault Tolerance', 'Authentication', 'Encryption', 'Metrics',
      'AI System Design Overview', 'Business Goals & Requirements', 'AI Architecture Layers', 'AI Model Types',
      'Data Engineering & Pipelines', 'Model Selection & Training', 'Evaluation & Metrics', 'Deployment & Serving',
      'AI Monitoring & Observability', 'Ethics & Governance', 'Retrieval-Augmented Generation', 'AI Agents & Tool Use',
      'Capstone - AI Support Assistant',
    ],
  },
  {
    title: 'Path 2 - System Design Engineer', icon: '🏗️', who: 'Developers who want to design systems, not just build features.', time: '≈ 15–20 hours', deep: true,
    goal: 'Cover all of Part 1 in order: read each basics note, then its deep dive.',
    lessons: 'part1',
  },
  {
    title: 'Path 3 - AI Systems Engineer', icon: '🤖', who: 'Engineers who know Part 1 (or took Path 2) and want to build AI systems.', time: '≈ 12–16 hours', deep: true,
    goal: 'Cover all of Part 2 in order, from business goals to the capstone.',
    lessons: 'part2',
  },
  {
    title: 'Path 4 - LLM App Builder', icon: '⚡', who: 'Builders shipping chatbots, copilots or agents on top of LLM APIs.', time: '≈ 6–8 hours', deep: true,
    goal: 'The shortest route to designing a solid LLM application.',
    lessons: [
      'API Design', 'Caching', 'Rate Limiting', 'AI Model Types', 'Context Engineering', 'Embeddings & Vector Databases',
      'Retrieval-Augmented Generation', 'AI Agents & Tool Use', 'LLM Inference & Optimization', 'Evaluation & Metrics',
      'Guardrails & AI Safety', 'AI Monitoring & Observability', 'Cost Optimization', 'Capstone - AI Support Assistant',
    ],
  },
  {
    title: 'Path 5 - Interview Prep', icon: '🎯', who: 'Anyone preparing for a system design or ML system design interview.', time: '≈ 8–10 hours', deep: true,
    goal: 'The topics interviewers ask about most, in the order you would use them in an interview.',
    lessons: [
      'Requirements', 'Estimation', 'Trade-offs', 'API Design', 'SQL Databases', 'NoSQL Databases', 'CAP Theorem',
      'Replication', 'Sharding', 'Caching', 'Load Balancing', 'Message Queues', 'Rate Limiting', 'High-Level Design',
      'Low-Level Design', 'Case Studies', 'AI Architecture Layers', 'Deployment & Serving', 'Retrieval-Augmented Generation',
      'LLM Inference & Optimization', 'Capstone - AI Support Assistant',
    ],
  },
];

// Flattened views used by the scripts.
export function allTopics() {
  const out = [];
  for (const part of PARTS) {
    for (const section of part.sections) {
      const groups = section.branches ?? [{ title: null, topics: section.topics }];
      for (const branch of groups) {
        for (const [title, aliases, summary] of branch.topics) {
          const folder = [part.title, section.folder, branch.title].filter(Boolean).join('/');
          out.push({ title, aliases, summary, folder, part, section, branch: branch.title ? branch : null });
        }
      }
    }
  }
  return out;
}

export function allHubs() {
  const out = [];
  for (const part of PARTS) {
    out.push({ title: part.title, folder: part.title, kind: 'part', part });
    for (const section of part.sections) {
      out.push({ title: section.title, folder: `${part.title}/${section.folder}`, kind: 'section', part, section });
      for (const branch of section.branches ?? []) {
        out.push({ title: branch.title, folder: `${part.title}/${section.folder}/${branch.title}`, kind: 'branch', part, section, branch });
      }
    }
  }
  return out;
}
