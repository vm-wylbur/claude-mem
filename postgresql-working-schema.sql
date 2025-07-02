-- PostgreSQL Schema (auto-synced 2025-07-02 18:33:58 UTC)
-- This schema was automatically extracted from the live database
-- DO NOT EDIT MANUALLY - Use ./scripts/sync-schema.sh to update

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5 (Ubuntu 17.5-0ubuntu0.25.04.1)
-- Dumped by pg_dump version 17.5 (Ubuntu 17.5-0ubuntu0.25.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: memories; Type: TABLE; Schema: public; Owner: pball
--

CREATE TABLE public.memories (
    memory_id text NOT NULL,
    project_id integer NOT NULL,
    content text NOT NULL,
    content_type character varying(50) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    embedding public.vector(768),
    CONSTRAINT memories_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['conversation'::character varying, 'code'::character varying, 'decision'::character varying, 'reference'::character varying])::text[])))
);


ALTER TABLE public.memories OWNER TO pball;

--
-- Name: memory_relationships; Type: TABLE; Schema: public; Owner: pball
--

CREATE TABLE public.memory_relationships (
    relationship_id integer NOT NULL,
    source_memory_id text NOT NULL,
    target_memory_id text NOT NULL,
    relationship_type character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.memory_relationships OWNER TO pball;

--
-- Name: memory_relationships_relationship_id_seq; Type: SEQUENCE; Schema: public; Owner: pball
--

CREATE SEQUENCE public.memory_relationships_relationship_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.memory_relationships_relationship_id_seq OWNER TO pball;

--
-- Name: memory_relationships_relationship_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pball
--

ALTER SEQUENCE public.memory_relationships_relationship_id_seq OWNED BY public.memory_relationships.relationship_id;


--
-- Name: memory_tags; Type: TABLE; Schema: public; Owner: pball
--

CREATE TABLE public.memory_tags (
    memory_id text NOT NULL,
    tag_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.memory_tags OWNER TO pball;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.projects (
    project_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_accessed timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.projects OWNER TO postgres;

--
-- Name: projects_project_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.projects_project_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.projects_project_id_seq OWNER TO postgres;

--
-- Name: projects_project_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.projects_project_id_seq OWNED BY public.projects.project_id;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tags (
    tag_id bigint NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.tags OWNER TO postgres;

--
-- Name: tags_tag_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tags_tag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tags_tag_id_seq OWNER TO postgres;

--
-- Name: tags_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tags_tag_id_seq OWNED BY public.tags.tag_id;


--
-- Name: memory_relationships relationship_id; Type: DEFAULT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_relationships ALTER COLUMN relationship_id SET DEFAULT nextval('public.memory_relationships_relationship_id_seq'::regclass);


--
-- Name: projects project_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects ALTER COLUMN project_id SET DEFAULT nextval('public.projects_project_id_seq'::regclass);


--
-- Name: tags tag_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags ALTER COLUMN tag_id SET DEFAULT nextval('public.tags_tag_id_seq'::regclass);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (memory_id);


--
-- Name: memory_relationships memory_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_relationships
    ADD CONSTRAINT memory_relationships_pkey PRIMARY KEY (relationship_id);


--
-- Name: memory_relationships memory_relationships_source_memory_id_target_memory_id_rela_key; Type: CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_relationships
    ADD CONSTRAINT memory_relationships_source_memory_id_target_memory_id_rela_key UNIQUE (source_memory_id, target_memory_id, relationship_type);


--
-- Name: memory_tags memory_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_tags
    ADD CONSTRAINT memory_tags_pkey PRIMARY KEY (memory_id, tag_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- Name: tags tags_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (tag_id);


--
-- Name: idx_memories_content_type; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memories_content_type ON public.memories USING btree (content_type);


--
-- Name: idx_memories_created_at; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memories_created_at ON public.memories USING btree (created_at DESC);


--
-- Name: idx_memories_embedding_cosine; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memories_embedding_cosine ON public.memories USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: idx_memories_metadata; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memories_metadata ON public.memories USING gin (metadata);


--
-- Name: idx_memories_project_id; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memories_project_id ON public.memories USING btree (project_id);


--
-- Name: idx_memory_relationships_source; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memory_relationships_source ON public.memory_relationships USING btree (source_memory_id);


--
-- Name: idx_memory_relationships_target; Type: INDEX; Schema: public; Owner: pball
--

CREATE INDEX idx_memory_relationships_target ON public.memory_relationships USING btree (target_memory_id);


--
-- Name: memories memories_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON DELETE CASCADE;


--
-- Name: memory_relationships memory_relationships_source_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_relationships
    ADD CONSTRAINT memory_relationships_source_memory_id_fkey FOREIGN KEY (source_memory_id) REFERENCES public.memories(memory_id) ON DELETE CASCADE;


--
-- Name: memory_relationships memory_relationships_target_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_relationships
    ADD CONSTRAINT memory_relationships_target_memory_id_fkey FOREIGN KEY (target_memory_id) REFERENCES public.memories(memory_id) ON DELETE CASCADE;


--
-- Name: memory_tags memory_tags_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_tags
    ADD CONSTRAINT memory_tags_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(memory_id) ON DELETE CASCADE;


--
-- Name: memory_tags memory_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pball
--

ALTER TABLE ONLY public.memory_tags
    ADD CONSTRAINT memory_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(tag_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

