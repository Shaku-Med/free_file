export const loader = async ({ params }: { params: { jobId?: string } }) => {
  const jobId = params.jobId
  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    })
  }

  return new Response(
    JSON.stringify({
      jobId,
      status: "completed"
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  )
}


