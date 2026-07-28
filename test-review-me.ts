// Temporary file to test the AI code reviewer. Safe to delete.
export async function getProject(req, res) {
  const id = req.query.id
  const sql = 'SELECT * FROM projects WHERE id = ' + id
  const rows = await db.query(sql)
  console.log('auth header was', req.headers.authorization)
  res.json(rows)
}
