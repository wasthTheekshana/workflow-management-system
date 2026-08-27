SELECT 'CREATE DATABASE workflow_engine_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'workflow_engine_test')
\gexec
