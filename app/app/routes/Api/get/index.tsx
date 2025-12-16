import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { FileService } from '../../../lib/Services/FileService';
import type { PaginationParams } from '../../../lib/Services/FileService';
import { getCookie } from '~/lib/Security/Token';
import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { ownerService } from '~/lib/Services/OwnerService';
import { userActionsService } from '~/lib/Services/UserActionsService';
import { isAuthenticated } from '~/lib/Security/Password';

export const loader = async ({ request }: { request: Request }) => {
    try {
        let keys = ['token1', 'token2']
        let token = getCookie('token', request.headers)
        if(!token) return new Response(JSON.stringify({ 
            error: 'Unauthorized' 
        }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });

        let decoded = await VerifyToken({
            token: token,
            addedKeyNames: keys || []
        }, request.headers)
        if(!decoded) return new Response(JSON.stringify({ 
            error: 'Access Denied!' 
        }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '10');
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

        const validSortFields = ['created_at', 'filename', 'file_size', 'file_type', 'is_adult', 'up_count', 'down_count'];
        if (!validSortFields.includes(sortBy)) {
            return new Response(JSON.stringify({ 
                error: `Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}` 
            }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!db) {
            return new Response(JSON.stringify({ 
                error: 'Database not initialized' 
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const fetchMultiplier = 3;
        const fetchLimit = limit * fetchMultiplier;
        const offset = (page - 1) * limit;

        let query = db
            .from('files')
            .select('*', { count: 'exact' });

        if (fileType) {
            query = query.like('file_type', `${fileType}%`);
        }

        const { data: allFiles, error: queryError, count } = await query
            .order(sortBy, { ascending: sortOrder === 'asc' })
            .range(offset, offset + fetchLimit - 1);

        if (queryError) {
            console.error('Database query error:', queryError);
            return new Response(JSON.stringify({ 
                error: 'Failed to fetch files' 
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const filteredFiles = await filterFilesByAccess(request, allFiles || []);
        const paginatedFiles = filteredFiles.slice(0, limit);

        // Enrich files with owner data
        const filesWithOwners = await ownerService.enrichFilesWithOwners(paginatedFiles);

        // Fetch user actions in one query
        const user = await isAuthenticated(request, ['id']);
        let userActions = { likedFileIds: [], dislikedFileIds: [] };
        if (user?.id && filesWithOwners.length > 0) {
          const fileIds = filesWithOwners.map((f: any) => f.id).filter(Boolean);
          if (fileIds.length > 0) {
            const actions = await userActionsService.getUserActions(user.id, fileIds);
            userActions = {
              likedFileIds: Array.from(actions.likedFileIds),
              dislikedFileIds: Array.from(actions.dislikedFileIds)
            };
          }
        }

        const total = count || 0;
        const estimatedTotal = Math.floor(total * (filteredFiles.length / (allFiles?.length || 1)));
        const totalPages = Math.ceil(estimatedTotal / limit);

        const result = {
            data: filesWithOwners,
            userActions,
            pagination: {
                page,
                limit,
                total: estimatedTotal,
                totalPages,
                hasNext: paginatedFiles.length === limit && (page * limit < estimatedTotal),
                hasPrev: page > 1
            }
        };
        
        return new Response(JSON.stringify(result), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
             }
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
}