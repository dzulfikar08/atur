use std::path::Path;

use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexWriter, TantivyDocument, Term};
use tantivy::directory::MmapDirectory;

// ---------------------------------------------------------------------------
// Schema field handles (built once)
// ---------------------------------------------------------------------------

/// Build the Tantivy schema for our search index.
pub fn build_schema() -> Schema {
    let mut builder = Schema::builder();

    builder.add_text_field("id", STRING | STORED);
    builder.add_text_field("entity_type", STRING | STORED);
    builder.add_text_field("workspace_id", STRING | STORED);
    builder.add_text_field("project_id", STRING | STORED);
    builder.add_text_field("name", TEXT | STORED);
    builder.add_text_field("description", TEXT);
    builder.add_text_field("content", TEXT);

    builder.build()
}

/// Convenience struct holding the resolved field handles.
pub struct SearchFields {
    pub id: Field,
    pub entity_type: Field,
    pub workspace_id: Field,
    pub project_id: Field,
    pub name: Field,
    pub description: Field,
    pub content: Field,
}

impl SearchFields {
    pub fn from_schema(schema: &Schema) -> Self {
        Self {
            id: schema.get_field("id").expect("field 'id' missing"),
            entity_type: schema.get_field("entity_type").expect("field 'entity_type' missing"),
            workspace_id: schema.get_field("workspace_id").expect("field 'workspace_id' missing"),
            project_id: schema.get_field("project_id").expect("field 'project_id' missing"),
            name: schema.get_field("name").expect("field 'name' missing"),
            description: schema.get_field("description").expect("field 'description' missing"),
            content: schema.get_field("content").expect("field 'content' missing"),
        }
    }
}

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub entity_type: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub score: f32,
}

// ---------------------------------------------------------------------------
// Index lifecycle
// ---------------------------------------------------------------------------

/// Create or open a Tantivy index at the given directory path.
/// Creates the directory if it does not exist.
pub fn init_index(path: &str) -> anyhow::Result<Index> {
    let dir = Path::new(path);
    std::fs::create_dir_all(dir)?;

    let schema = build_schema();

    let mmap_dir = MmapDirectory::open(dir)?;

    // Try to open an existing index first; create a new one if it doesn't exist.
    let index = if dir.join(".tantivy-meta.json").exists()
        || dir.join("meta.json").exists()
    {
        Index::open(mmap_dir)?
    } else {
        Index::create(mmap_dir, schema, Default::default())?
    };

    // Ensure the index reader is warmed up
    let _reader = index.reader()?;

    Ok(index)
}

// ---------------------------------------------------------------------------
// Indexing helpers
// ---------------------------------------------------------------------------

/// Index (add or update) a single entity document.
///
/// The implementation uses delete-then-insert semantics so that calling this
/// for the same `(entity_type, id)` pair effectively updates the document.
pub fn index_entity(
    index: &Index,
    entity_type: &str,
    id: &str,
    workspace_id: &str,
    project_id: Option<&str>,
    name: &str,
    description: &str,
    content: &str,
) -> anyhow::Result<()> {
    let schema = index.schema();
    let fields = SearchFields::from_schema(&schema);

    let mut writer: IndexWriter = index.writer(15_000_000)?;

    // Delete any existing document with this id
    let delete_term = Term::from_field_text(fields.id, id);
    writer.delete_term(delete_term);

    // Insert the new document
    let mut document = TantivyDocument::default();
    document.add_text(fields.id, id);
    document.add_text(fields.entity_type, entity_type);
    document.add_text(fields.workspace_id, workspace_id);
    if let Some(pid) = project_id {
        document.add_text(fields.project_id, pid);
    }
    document.add_text(fields.name, name);
    document.add_text(fields.description, description);
    document.add_text(fields.content, content);

    writer.add_document(document)?;
    writer.commit()?;

    // Reload the reader so searches see the new data
    index.reader()?.reload()?;

    Ok(())
}

/// Remove a document from the search index by entity id.
pub fn remove_entity(index: &Index, id: &str) -> anyhow::Result<()> {
    let schema = index.schema();
    let fields = SearchFields::from_schema(&schema);

    let mut writer: IndexWriter = index.writer(15_000_000)?;

    let delete_term = Term::from_field_text(fields.id, id);
    writer.delete_term(delete_term);
    writer.commit()?;

    index.reader()?.reload()?;

    Ok(())
}

/// Search the index and return scored results.
///
/// If `workspace_id` is provided, results are filtered to that workspace only.
pub fn search(
    index: &Index,
    query: &str,
    workspace_id: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let schema = index.schema();
    let fields = SearchFields::from_schema(&schema);

    let reader = index.reader()?;
    let searcher = reader.searcher();

    // Build a query parser over the searchable text fields
    let query_parser = QueryParser::for_index(
        index,
        vec![fields.name, fields.description, fields.content],
    );

    // Parse the user query; fall back to a simple term query if parsing fails
    let parsed = query_parser.parse_query(query).unwrap_or_else(|_| {
        // If the query can't be parsed, try a fuzzy-like approach with a
        // simple term query on the name field
        query_parser.parse_query(&format!("\"{}\"", query)).unwrap_or_else(|_| {
            query_parser.parse_query("*").expect("wildcard parse should not fail")
        })
    });

    // If a workspace filter is needed, wrap with a boolean query
    let effective_query: Box<dyn tantivy::query::Query> = if let Some(ws_id) = workspace_id {
        let ws_term = Term::from_field_text(fields.workspace_id, ws_id);
        let ws_query = tantivy::query::TermQuery::new(ws_term, IndexRecordOption::Basic);
        let bool_query = tantivy::query::BooleanQuery::new(vec![
            (tantivy::query::Occur::Must, Box::new(parsed)),
            (tantivy::query::Occur::Must, Box::new(ws_query)),
        ]);
        Box::new(bool_query)
    } else {
        parsed
    };

    let top_docs = searcher.search(&effective_query, &TopDocs::with_limit(limit))?;

    let mut results = Vec::with_capacity(top_docs.len());
    for (score, doc_address) in top_docs {
        let doc: TantivyDocument = searcher.doc(doc_address)?;

        let id = doc.get_first(fields.id)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let entity_type = doc.get_first(fields.entity_type)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ws_id = doc.get_first(fields.workspace_id)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let project_id = doc.get_first(fields.project_id)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let name = doc.get_first(fields.name)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        results.push(SearchResult {
            id,
            entity_type,
            workspace_id: ws_id,
            project_id,
            name,
            score,
        });
    }

    Ok(results)
}
