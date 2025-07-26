const { Client } = require('@notionhq/client');

class NotionClient {
  constructor() {
    this.notion = new Client({
      auth: process.env.NOTION_API_KEY,
    });
    this.databaseId = process.env.NOTION_DATABASE_ID;
  }

  async createIdeaEntry(data) {
    try {
      const { title, rawText, attachments = [], status = 'Captured' } = data;
      
      const response = await this.notion.pages.create({
        parent: {
          database_id: this.databaseId,
        },
        properties: {
          'Idea title': {
            title: [
              {
                text: {
                  content: title || 'New Idea',
                },
              },
            ],
          },
          'Raw text': {
            rich_text: [
              {
                text: {
                  content: rawText || '',
                },
              },
            ],
          },
          'Status': {
            select: {
              name: status,
            },
          },
          'Created': {
            date: {
              start: new Date().toISOString(),
            },
          },
        },
      });

      // Add attachments if any
      if (attachments.length > 0) {
        await this.updateIdeaAttachments(response.id, attachments);
      }

      return response;
    } catch (error) {
      console.error('Error creating idea entry:', error);
      throw error;
    }
  }

  async updateIdeaEntry(pageId, updates) {
    try {
      const properties = {};

      if (updates.title) {
        properties['Idea title'] = {
          title: [{ text: { content: updates.title } }],
        };
      }

      if (updates.rawText) {
        properties['Raw text'] = {
          rich_text: [{ text: { content: updates.rawText } }],
        };
      }



      if (updates.category) {
        properties['Category'] = {
          select: { name: updates.category },
        };
      }

      if (updates.confidence !== undefined) {
        properties['Confidence'] = {
          number: updates.confidence,
        };
      }

      if (updates.status) {
        properties['Status'] = {
          select: { name: updates.status },
        };
      }

      const response = await this.notion.pages.update({
        page_id: pageId,
        properties,
      });

      // If we have business plan content, add it to the page body
      if (updates.businessPlanContent) {
        await this.addBusinessPlanContent(pageId, updates.businessPlanContent);
      }

      return response;
    } catch (error) {
      console.error('Error updating idea entry:', error);
      throw error;
    }
  }

  async updateIdeaAttachments(pageId, attachments) {
    try {
      const children = attachments.map(attachment => {
        if (attachment.type === 'file') {
          return {
            object: 'block',
            type: 'file',
            file: {
              type: 'external',
              external: {
                url: attachment.url,
              },
              caption: [{ text: { content: attachment.name || 'Attachment' } }],
            },
          };
        } else if (attachment.type === 'image') {
          return {
            object: 'block',
            type: 'image',
            image: {
              type: 'external',
              external: {
                url: attachment.url,
              },
              caption: [{ text: { content: attachment.name || 'Image' } }],
            },
          };
        }
      }).filter(Boolean);

      if (children.length > 0) {
        await this.notion.blocks.children.append({
          block_id: pageId,
          children,
        });
      }
    } catch (error) {
      console.error('Error updating attachments:', error);
      throw error;
    }
  }

  async getCategories() {
    try {
      const database = await this.notion.databases.retrieve({
        database_id: this.databaseId,
      });

      const categoryProperty = database.properties['Category'];
      if (categoryProperty && categoryProperty.type === 'select') {
        return categoryProperty.select.options.map(option => ({
          name: option.name,
          id: option.id,
          color: option.color,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting categories:', error);
      throw error;
    }
  }

  async addCategory(categoryName) {
    try {
      const database = await this.notion.databases.retrieve({
        database_id: this.databaseId,
      });

      const categoryProperty = database.properties['Category'];
      const existingOptions = categoryProperty.select.options || [];
      
      // Check if category already exists
      const exists = existingOptions.some(option => 
        option.name.toLowerCase() === categoryName.toLowerCase()
      );

      if (exists) {
        return { success: true, message: 'Category already exists' };
      }

      // Add new category option
      const newOptions = [
        ...existingOptions,
        {
          name: categoryName,
          color: this.getRandomColor(),
        },
      ];

      await this.notion.databases.update({
        database_id: this.databaseId,
        properties: {
          'Category': {
            select: {
              options: newOptions,
            },
          },
        },
      });

      return { success: true, message: 'Category added successfully' };
    } catch (error) {
      console.error('Error adding category:', error);
      throw error;
    }
  }

  async getIdeaStats() {
    try {
      const response = await this.notion.databases.query({
        database_id: this.databaseId,
      });

      const totalIdeas = response.results.length;
      const categoryStats = {};
      const statusStats = {};

      response.results.forEach(page => {
        // Category stats
        const category = page.properties['Category']?.select?.name || 'Uncategorized';
        categoryStats[category] = (categoryStats[category] || 0) + 1;

        // Status stats
        const status = page.properties['Status']?.select?.name || 'Unknown';
        statusStats[status] = (statusStats[status] || 0) + 1;
      });

      return {
        totalIdeas,
        categoryStats,
        statusStats,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error getting idea stats:', error);
      throw error;
    }
  }

  async addBusinessPlanContent(pageId, content) {
    try {
      console.log(`Adding business plan content to page ${pageId}...`);
      
      if (!content || content.trim().length === 0) {
        console.log('⚠️ No content to add to page');
        return;
      }

      // Convert markdown-style content to Notion blocks
      const sections = content.split(/(?=##\s)/);
      const blocks = [];

      for (const section of sections) {
        if (!section.trim()) continue;

        const lines = section.trim().split('\n');
        const headerLine = lines[0];
        
        if (headerLine.startsWith('## ')) {
          // Add header block
          const headerText = headerLine.replace('## ', '').trim();
          if (headerText) {
            blocks.push({
              object: 'block',
              type: 'heading_2',
              heading_2: {
                rich_text: [{ text: { content: headerText } }],
              },
            });
          }

          // Add content blocks
          const contentLines = lines.slice(1).join('\n').trim();
          if (contentLines) {
            // Split by bullet points or paragraphs
            const paragraphs = contentLines.split(/\n\s*\n/);
            
            for (const paragraph of paragraphs) {
              if (!paragraph.trim()) continue;
              
              if (paragraph.includes('- ')) {
                // Bullet list
                const items = paragraph.split(/\n- /).map(item => item.replace(/^- /, '').trim()).filter(item => item);
                for (const item of items) {
                  blocks.push({
                    object: 'block',
                    type: 'bulleted_list_item',
                    bulleted_list_item: {
                      rich_text: [{ text: { content: item } }],
                    },
                  });
                }
              } else {
                // Regular paragraph
                const cleanParagraph = paragraph.trim();
                if (cleanParagraph) {
                  blocks.push({
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                      rich_text: [{ text: { content: cleanParagraph } }],
                    },
                  });
                }
              }
            }
          }
        }
      }

      if (blocks.length === 0) {
        console.log('⚠️ No blocks generated from content');
        return;
      }

      // Add blocks to page in chunks (Notion API limit: 100 blocks per request)
      const chunkSize = 50;
      for (let i = 0; i < blocks.length; i += chunkSize) {
        const chunk = blocks.slice(i, i + chunkSize);
        
        try {
          await this.notion.blocks.children.append({
            block_id: pageId,
            children: chunk,
          });
          console.log(`✅ Added chunk ${Math.floor(i/chunkSize) + 1} (${chunk.length} blocks)`);
        } catch (chunkError) {
          console.error(`❌ Failed to add chunk ${Math.floor(i/chunkSize) + 1}:`, chunkError.message);
          // Continue with other chunks
        }
      }

      console.log(`✅ Added ${blocks.length} content blocks to Notion page`);
    } catch (error) {
      console.error('❌ Error adding business plan content:', error.message);
      // Don't throw - this shouldn't break the main flow
    }
  }

  getRandomColor() {
    const colors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  async retryWithBackoff(operation, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (error.code === 'rate_limited' && i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }
}

module.exports = NotionClient; 