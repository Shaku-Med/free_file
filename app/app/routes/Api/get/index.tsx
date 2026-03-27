import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { FileService } from '../../../lib/Services/FileService';
import type { PaginationParams } from '../../../lib/Services/FileService';
import { getCookie } from '~/lib/Security/Token';
import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { ownerService } from '~/lib/Services/OwnerService';
import { userActionsService } from '~/lib/Services/UserActionsService';
import { isAuthenticated } from '~/lib/Security/Password';
import { validatePagination, sanitizeString } from '~/lib/Security/inputValidation';

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
        
        const pageParam = searchParams.get('page') || '1';
        const limitParam = searchParams.get('limit') || '20';
        const sortBy = searchParams.get('sortBy') || 'views';
        const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';
        const fileTypeParam = searchParams.get('fileType');
        
        // Sanitize fileType if provided
        const fileType = fileTypeParam ? sanitizeString(fileTypeParam, 50) : undefined;

        // Validate pagination
        const validatedPagination = validatePagination(pageParam, limitParam, 100);
        if (!validatedPagination) {
            return new Response(JSON.stringify({ 
                error: 'Invalid pagination parameters. Page must be >= 1, limit must be between 1-100' 
            }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const { page: validatedPage, limit: validatedLimit } = validatedPagination;

        // Validate sortBy field
        const validSortFields = ['created_at', 'filename', 'file_size', 'file_type', 'is_adult', 'up_count', 'down_count', 'file_title', 'category', 'views', 'shares', 'likes', 'watch_time'];
        if (!validSortFields.includes(sortBy)) {
            return new Response(JSON.stringify({ 
                error: `Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}` 
            }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate fileType if provided
        if (fileType && fileType.length > 50) {
            return new Response(JSON.stringify({ 
                error: 'fileType parameter is too long' 
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
        const fetchLimit = validatedLimit * fetchMultiplier;
        const offset = (validatedPage - 1) * validatedLimit;

        let query = db
            .from('files')
            .select('id, filename, unique_id, up_count, down_count, views, view_count, shares, share_count, file_size, file_type, endpoint, created_at, is_adult, is_public, owner_id, default_thumbnail, file_title, category', { count: 'exact' });

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

        // Filter by access control first, then paginate
        const filteredFiles = await filterFilesByAccess(request, allFiles || []);
        const paginatedFiles = filteredFiles.slice(0, validatedLimit);

        // Enrich files with owner data
        const filesWithOwners = await ownerService.enrichFilesWithOwners(paginatedFiles);

        // Fetch user actions in one query
        const user = await isAuthenticated(request, ['id']);
        let userActions: { likedFileIds: string[]; dislikedFileIds: string[] } = { likedFileIds: [], dislikedFileIds: [] };
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
        const totalPages = Math.ceil(estimatedTotal / validatedLimit);

        const result = {
            data: filesWithOwners,
            userActions,
            pagination: {
                page: validatedPage,
                limit: validatedLimit,
                total: estimatedTotal,
                totalPages,
                hasNext: paginatedFiles.length === validatedLimit && (validatedPage * validatedLimit < estimatedTotal),
                hasPrev: validatedPage > 1
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