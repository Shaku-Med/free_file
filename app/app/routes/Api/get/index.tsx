import { FileService } from '../../../lib/Services/FileService';
import type { PaginationParams } from '../../../lib/Services/FileService';
import { createRateLimit, rateLimitConfigs } from '../../../lib/middleware/rateLimiter';

const getRateLimit = createRateLimit(rateLimitConfigs.api);

export const loader = async ({ request }: { request: Request }) => {
    return getRateLimit(request, async () => {
        try {
            const url = new URL(request.url);
            const searchParams = url.searchParams;
            
            const page = parseInt(searchParams.get('page') || '1');
            const limit = parseInt(searchParams.get('limit') || '50');
            const sortBy = searchParams.get('sortBy') || 'created_at';
            const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
            const fileType = searchParams.get('fileType') || undefined;

            if (page < 1 || limit < 1 || limit > 100) {
                return new Response(JSON.stringify({ 
                    error: 'Invalid pagination parameters. Page must be >= 1, limit must be between 1-100' 
                }), { 
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const validSortFields = ['created_at', 'filename', 'file_size', 'file_type'];
            if (!validSortFields.includes(sortBy)) {
                return new Response(JSON.stringify({ 
                    error: `Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}` 
                }), { 
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const fileService = new FileService(
                process.env.GITHUB_TOKEN || '',
                process.env.GITHUB_OWNER || ''
            );

            const paginationParams: PaginationParams = {
                page,
                limit,
                sortBy,
                sortOrder,
                fileType
            };

            const result = await fileService.getFilesPaginated(paginationParams);
            
            return new Response(JSON.stringify(result), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        catch (error) {
            console.error('Error fetching files:', error);
            return new Response(JSON.stringify({ 
                error: 'Internal server error' 
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });
}