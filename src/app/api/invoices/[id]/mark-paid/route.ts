import { NextRequest } from "next/server"
import { postMarkPaid } from "./handler"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return postMarkPaid(id)
}
